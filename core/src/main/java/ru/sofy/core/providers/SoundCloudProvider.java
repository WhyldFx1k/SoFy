package ru.sofy.core.providers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import ru.sofy.core.Json;
import ru.sofy.core.Track;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SoundCloud integration.
 *
 * Uses the public web API with a client_id that is discovered automatically
 * from SoundCloud's own JS bundles (cached for 6h, persisted to disk),
 * refreshed once on 401/403. Playback prefers progressive streams and falls
 * back to HLS, re-resolving signed CDN URLs once when they expire.
 */
public final class SoundCloudProvider implements MusicProvider {
    private static final String API = "https://api-v2.soundcloud.com";
    private static final String UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 SoFy/0.1";
    private static final Pattern JS_BUNDLE = Pattern.compile(
            "(?:https:)?//a-v2\\.sndcdn\\.com/assets/[A-Za-z0-9._~/-]+\\.js");
    private static final Pattern CLIENT_ID = Pattern.compile(
            "client_id\\s*[:=]\\s*[\"']([A-Za-z0-9]{20,64})[\"']");
    private static final long CLIENT_ID_TTL_MS = 6 * 60 * 60_000L;
    private static final int MAX_BUNDLES = 12;

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    private final Path cacheFile;
    private final Object discoveryLock = new Object();
    private volatile String manualClientId;
    private volatile String autoClientId;
    private volatile long autoExpiresAt;
    private volatile long retryAfterMs;
    private volatile boolean cacheLoaded;

    public SoundCloudProvider(Path dataDir) {
        this.cacheFile = dataDir.resolve("soundcloud-client.json");
        loadCache();
    }

    public void setCredential(String credential) {
        String value = credential == null ? null : credential.trim();
        this.manualClientId = value == null || value.isBlank() ? null : value;
    }

    public boolean hasManualCredential() {
        return manualClientId != null;
    }

    public boolean hasAutoCredential() {
        return autoClientId != null && System.currentTimeMillis() < autoExpiresAt;
    }

    @Override
    public String id() {
        return "soundcloud";
    }

    @Override
    public String label() {
        return "SoundCloud";
    }

    @Override
    public boolean isConfigured() {
        // The web client_id is discovered lazily, so SoundCloud is always usable.
        return true;
    }

    // ------------------------------------------------------------------ search

    @Override
    public List<Track> search(String query, int limit, int offset) throws ProviderException {
        int safeLimit = Math.max(1, Math.min(limit, 50));
        int safeOffset = Math.max(0, offset);
        String url = API + "/search/tracks?q=" + encode(query) + "&limit=" + safeLimit
                + "&offset=" + safeOffset + "&linked_partitioning=0";
        JsonNode root = apiGet(url);
        JsonNode collection = root.path("collection");
        List<Track> result = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        if (!collection.isArray()) return result;

        for (JsonNode item : collection) {
            if (result.size() >= safeLimit) break;
            Track track = mapTrack(item);
            if (track == null || !track.streamable()) continue;
            if (track.durationMs() > 0 && track.durationMs() < 15_000) continue;
            String key = normalize(track.artist()) + "|" + normalize(track.title());
            if (!seen.add(key)) continue;
            result.add(track);
        }
        return result;
    }

    private Track mapTrack(JsonNode node) {
        String externalId = node.path("id").asText("");
        if (!externalId.matches("\\d{1,25}")) return null;
        String title = node.path("title").asText("Без названия");
        String artist = node.path("user").path("username").asText("SoundCloud");
        String album = node.path("publisher_metadata").path("album_title").asText(null);
        long duration = node.path("duration").asLong(0);
        String artwork = node.path("artwork_url").asText(null);
        if (artwork == null || artwork.isBlank()) {
            artwork = node.path("user").path("avatar_url").asText(null);
        }
        if (artwork != null) {
            artwork = artwork.replace("-large", "-t500x500");
        }

        String access = node.path("access").asText("playable");
        String policy = node.path("policy").asText("");
        boolean blocked = "blocked".equalsIgnoreCase(access) || "BLOCK".equalsIgnoreCase(policy);
        boolean preview = "preview".equalsIgnoreCase(access)
                || "SNIP".equalsIgnoreCase(policy)
                || node.path("snipped").asBoolean(false);
        boolean streamable = node.path("streamable").asBoolean(true) && !blocked;
        return new Track("soundcloud:" + externalId, "soundcloud", externalId, title, artist,
                album, duration, artwork, null, preview, streamable);
    }

    private static String normalize(String value) {
        String lower = value == null ? "" : value.toLowerCase(Locale.ROOT);
        return lower.replaceAll("[^a-z0-9а-яё]+", "").trim();
    }

    // ---------------------------------------------------------------- playback

    @Override
    public Prepared prepare(Track track) throws ProviderException {
        if (!track.externalId().matches("\\d{1,25}")) {
            throw new ProviderException("Некорректный идентификатор трека SoundCloud");
        }
        JsonNode node = apiGet(API + "/tracks/" + track.externalId());
        String access = node.path("access").asText("playable");
        if ("blocked".equalsIgnoreCase(access)) {
            throw new ProviderException("SoundCloud заблокировал этот трек в вашем регионе");
        }

        JsonNode transcodings = node.path("media").path("transcodings");
        if (!transcodings.isArray() || transcodings.isEmpty()) {
            throw new ProviderException("У трека нет доступных потоков SoundCloud");
        }

        List<JsonNode> candidates = new ArrayList<>();
        for (JsonNode item : transcodings) {
            if (scoreTranscoding(item) >= 0) candidates.add(item);
        }
        candidates.sort((a, b) -> Integer.compare(scoreTranscoding(b), scoreTranscoding(a)));
        if (candidates.isEmpty()) throw new ProviderException("Не удалось выбрать поток SoundCloud");

        String trackAuthorization = node.path("track_authorization").asText(null);
        ProviderException lastError = null;
        for (int i = 0; i < Math.min(candidates.size(), 6); i++) {
            JsonNode chosen = candidates.get(i);
            String transcodingUrl = chosen.path("url").asText(null);
            if (transcodingUrl == null || !transcodingUrl.startsWith("https://")) continue;
            if (trackAuthorization != null && !trackAuthorization.isBlank()) {
                transcodingUrl = appendParam(transcodingUrl, "track_authorization", trackAuthorization);
            }
            try {
                JsonNode resolved = apiGet(transcodingUrl);
                String directUrl = resolved.path("url").asText(null);
                if (directUrl == null || !allowedMediaHost(directUrl)) continue;
                String protocol = chosen.path("format").path("protocol").asText("progressive");
                String kind = "hls".equalsIgnoreCase(protocol) ? "hls" : "progressive";
                return new Prepared(kind, directUrl);
            } catch (ProviderException e) {
                // One transcoding can be dead while another works (SoundCloud ABR).
                lastError = e;
            }
        }
        throw new ProviderException("SoundCloud не отдал рабочий поток"
                + (lastError == null ? "." : ": " + lastError.getMessage()));
    }

    private static int scoreTranscoding(JsonNode item) {
        String protocol = item.path("format").path("protocol").asText("");
        if (!protocol.equals("progressive") && !protocol.equals("hls")) return -1;
        int score = protocol.equals("progressive") ? 1000 : 500;
        String mime = item.path("format").path("mime_type").asText("").toLowerCase(Locale.ROOT);
        String preset = item.path("preset").asText("").toLowerCase(Locale.ROOT);
        boolean playlistMime = mime.contains("mpegurl");
        if (!playlistMime && (mime.contains("mpeg") || preset.contains("mp3"))) score += 100;
        else if (!playlistMime && (mime.contains("mp4") || mime.contains("aac"))) score += 80;
        else if (mime.contains("ogg") || preset.contains("opus")) score += 40;
        if (preset.startsWith("abr")) score -= 50;
        if (item.path("quality").asText("").equals("hq")) score += 10;
        return score;
    }

    @Override
    public Upstream open(Track track, Prepared prepared, String rangeHeader) throws ProviderException {
        if (!"progressive".equals(prepared.kind())) {
            throw new ProviderException("HLS-поток обслуживается отдельным прокси");
        }
        Upstream upstream = requestStream(prepared.url(), rangeHeader);
        if (isExpired(upstream.status())) {
            upstream.close();
            Prepared fresh = prepare(track);
            if (!"progressive".equals(fresh.kind())) {
                throw new ProviderException("Поток SoundCloud сменился на HLS, обновите трек");
            }
            upstream = requestStream(fresh.url(), rangeHeader);
        }
        if (upstream.status() >= 400) {
            int status = upstream.status();
            upstream.close();
            if (status == 401 || status == 403) {
                throw new ProviderException("SoundCloud не отдал поток. Возможно, нужна подписка Go+.");
            }
            if (status == 404 || status == 410) {
                throw new ProviderException("Поток SoundCloud больше не доступен.");
            }
            throw new ProviderException("SoundCloud вернул ошибку " + status);
        }
        return upstream;
    }

    private Upstream requestStream(String url, String rangeHeader) throws ProviderException {
        try {
            HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(25))
                    .header("User-Agent", UA)
                    .header("Accept", "*/*")
                    .header("Referer", "https://soundcloud.com/")
                    .GET();
            if (rangeHeader != null && !rangeHeader.isBlank()) {
                builder.header("Range", rangeHeader);
            }
            HttpResponse<InputStream> response = HTTP.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
            var headers = new java.util.LinkedHashMap<String, String>();
            response.headers().firstValue("Content-Type").ifPresent(v -> headers.put("Content-Type", v));
            response.headers().firstValue("Content-Length").ifPresent(v -> headers.put("Content-Length", v));
            response.headers().firstValue("Content-Range").ifPresent(v -> headers.put("Content-Range", v));
            response.headers().firstValue("Accept-Ranges").ifPresent(v -> headers.put("Accept-Ranges", v));
            if (!headers.containsKey("Content-Type")) headers.put("Content-Type", "audio/mpeg");
            return new Upstream(response.statusCode(), headers, response.body());
        } catch (Exception e) {
            throw new ProviderException("Не удалось получить поток SoundCloud", e);
        }
    }

    private static boolean isExpired(int status) {
        return status == 401 || status == 403 || status == 410;
    }

    private static boolean allowedMediaHost(String url) {
        try {
            URI uri = URI.create(url);
            if (!"https".equalsIgnoreCase(uri.getScheme())) return false;
            String host = uri.getHost();
            if (host == null) return false;
            host = host.toLowerCase(Locale.ROOT);
            return host.equals("sndcdn.com") || host.endsWith(".sndcdn.com")
                    || host.equals("soundcloud.com") || host.endsWith(".soundcloud.com")
                    || host.endsWith(".soundcloud.cloud");
        } catch (Exception e) {
            return false;
        }
    }

    // -------------------------------------------------------------------- auth

    private String requireClientId() throws ProviderException {
        String manual = manualClientId;
        if (manual != null) return manual;
        if (hasAutoCredential()) return autoClientId;

        synchronized (discoveryLock) {
            if (hasAutoCredential()) return autoClientId;
            if (!cacheLoaded) loadCache();
            if (hasAutoCredential()) return autoClientId;

            long now = System.currentTimeMillis();
            if (autoClientId != null && now < retryAfterMs) return autoClientId;

            String discovered = discoverClientId();
            if (discovered != null) {
                autoClientId = discovered;
                autoExpiresAt = now + CLIENT_ID_TTL_MS;
                retryAfterMs = 0;
                persistCache();
                return discovered;
            }
            retryAfterMs = now + 60_000;
            if (autoClientId != null) return autoClientId;
            throw new ProviderException(
                    "Не удалось автоматически получить ключ SoundCloud. Укажите client_id в настройках.");
        }
    }

    private void invalidateAutoClientId() {
        synchronized (discoveryLock) {
            autoClientId = null;
            autoExpiresAt = 0;
            retryAfterMs = 0;
            try {
                Files.deleteIfExists(cacheFile);
            } catch (IOException ignored) {
                // stale cache will be overwritten after a successful refresh
            }
        }
    }

    private JsonNode apiGet(String url) throws ProviderException {
        String rejected = null;
        for (int attempt = 0; attempt < 2; attempt++) {
            String clientId = requireClientId();
            String withKey = appendParam(url, "client_id", clientId);
            HttpResponse<String> response = sendJson(withKey);
            int status = response.statusCode();

            if ((status == 401 || status == 403) && attempt == 0) {
                if (manualClientId != null) {
                    throw new ProviderException(
                            "SoundCloud отклонил client_id из настроек. Проверьте ключ или очистите поле.");
                }
                rejected = clientId;
                invalidateAutoClientId();
                continue;
            }
            if (status == 200) {
                try {
                    return Json.MAPPER.readTree(response.body());
                } catch (Exception e) {
                    throw new ProviderException("SoundCloud вернул некорректный ответ", e);
                }
            }
            if (status == 401 || status == 403) {
                throw new ProviderException("SoundCloud отклонил ключ доступа" +
                        (rejected == null ? "" : " даже после обновления") + ".");
            }
            if (status == 429) {
                throw new ProviderException("Слишком много запросов к SoundCloud. Подождите немного.");
            }
            if (status == 404) {
                throw new ProviderException("SoundCloud: трек или страница не найдены.");
            }
            throw new ProviderException("SoundCloud вернул ошибку " + status);
        }
        throw new ProviderException("Не удалось авторизоваться в SoundCloud");
    }

    private HttpResponse<String> sendJson(String url) throws ProviderException {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(15))
                    .header("User-Agent", UA)
                    .header("Accept", "application/json")
                    .header("Accept-Language", "ru-RU,ru;q=0.9,en;q=0.8")
                    .header("Referer", "https://soundcloud.com/")
                    .GET()
                    .build();
            return HTTP.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (Exception e) {
            throw new ProviderException("SoundCloud недоступен. Проверьте соединение.", e);
        }
    }

    private String discoverClientId() {
        Set<String> bundles = new LinkedHashSet<>();
        Set<String> candidates = new LinkedHashSet<>();

        String mainPage = fetchText("https://soundcloud.com/");
        if (mainPage != null) {
            collectClientIds(mainPage, candidates);
            collectBundles(mainPage, bundles);
        }
        if (bundles.size() < 4) {
            String discoverPage = fetchText("https://soundcloud.com/discover");
            if (discoverPage != null) {
                collectClientIds(discoverPage, candidates);
                collectBundles(discoverPage, bundles);
            }
        }

        List<String> urls = new ArrayList<>(bundles);
        if (urls.size() > MAX_BUNDLES) urls = urls.subList(0, MAX_BUNDLES);
        if (!urls.isEmpty()) {
            ExecutorService pool = Executors.newFixedThreadPool(Math.min(4, urls.size()), runnable -> {
                Thread thread = new Thread(runnable, "sofy-sc-discovery");
                thread.setDaemon(true);
                return thread;
            });
            try {
                CompletionService<List<String>> completion = new ExecutorCompletionService<>(pool);
                for (String url : urls) {
                    completion.submit(() -> {
                        String body = fetchText(url);
                        List<String> found = new ArrayList<>();
                        if (body != null) {
                            Set<String> ids = new LinkedHashSet<>();
                            collectClientIds(body, ids);
                            found.addAll(ids);
                        }
                        return found;
                    });
                }
                long deadline = System.currentTimeMillis() + 20_000;
                for (int i = 0; i < urls.size(); i++) {
                    long wait = deadline - System.currentTimeMillis();
                    if (wait <= 0) break;
                    Future<List<String>> future = completion.poll(wait, TimeUnit.MILLISECONDS);
                    if (future == null) break;
                    try {
                        candidates.addAll(future.get());
                    } catch (Exception ignored) {
                        // try the next bundle
                    }
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } finally {
                pool.shutdownNow();
            }
        }

        int checked = 0;
        for (String candidate : candidates) {
            if (checked++ >= 8) break;
            if (verifyClientId(candidate)) return candidate;
        }
        return null;
    }

    private boolean verifyClientId(String clientId) {
        try {
            String url = API + "/search/tracks?q=sofy&limit=1&client_id=" + encode(clientId);
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(10))
                    .header("User-Agent", UA)
                    .header("Accept", "application/json")
                    .header("Referer", "https://soundcloud.com/")
                    .GET()
                    .build();
            HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
            return response.statusCode() == 200;
        } catch (Exception e) {
            return false;
        }
    }

    private static void collectBundles(String html, Set<String> bundles) {
        Matcher matcher = JS_BUNDLE.matcher(html);
        while (matcher.find() && bundles.size() < MAX_BUNDLES * 2) {
            String url = matcher.group();
            if (url.startsWith("//")) url = "https:" + url;
            bundles.add(url);
        }
    }

    private static void collectClientIds(String text, Set<String> candidates) {
        if (text == null) return;
        Matcher matcher = CLIENT_ID.matcher(text);
        while (matcher.find() && candidates.size() < 12) {
            candidates.add(matcher.group(1));
        }
    }

    private String fetchText(String url) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(12))
                    .header("User-Agent", UA)
                    .header("Accept", "text/html,application/javascript,*/*;q=0.8")
                    .header("Accept-Language", "ru-RU,ru;q=0.9,en;q=0.8")
                    .GET()
                    .build();
            HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) return null;
            String body = response.body();
            return body.length() > 8 * 1024 * 1024 ? body.substring(0, 8 * 1024 * 1024) : body;
        } catch (Exception e) {
            return null;
        }
    }

    private void loadCache() {
        synchronized (discoveryLock) {
            cacheLoaded = true;
            try {
                if (!Files.isRegularFile(cacheFile)) return;
                JsonNode node = Json.MAPPER.readTree(Files.readString(cacheFile, StandardCharsets.UTF_8));
                String id = node.path("clientId").asText(null);
                long expiresAt = node.path("expiresAt").asLong(0);
                if (id != null && id.matches("[A-Za-z0-9]{20,64}")) {
                    autoClientId = id;
                    autoExpiresAt = expiresAt;
                }
            } catch (Exception ignored) {
                // corrupt cache is simply ignored
            }
        }
    }

    private void persistCache() {
        synchronized (discoveryLock) {
            try {
                ObjectNode node = Json.MAPPER.createObjectNode();
                node.put("clientId", autoClientId);
                node.put("expiresAt", autoExpiresAt);
                Path parent = cacheFile.getParent();
                if (parent != null) Files.createDirectories(parent);
                Path tmp = cacheFile.resolveSibling(cacheFile.getFileName() + ".tmp");
                Files.writeString(tmp, Json.MAPPER.writeValueAsString(node), StandardCharsets.UTF_8);
                try {
                    Files.move(tmp, cacheFile, StandardCopyOption.REPLACE_EXISTING,
                            StandardCopyOption.ATOMIC_MOVE);
                } catch (IOException e) {
                    Files.move(tmp, cacheFile, StandardCopyOption.REPLACE_EXISTING);
                }
            } catch (IOException ignored) {
                // caching is an optimization only
            }
        }
    }

    private static String appendParam(String url, String name, String value) {
        String separator = url.contains("?") ? "&" : "?";
        return url + separator + name + "=" + encode(value);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
