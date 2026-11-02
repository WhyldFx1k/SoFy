package ru.sofy.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import ru.sofy.core.providers.ProviderException;
import ru.sofy.core.providers.Providers;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

public final class Api {
    private static final Logger log = LoggerFactory.getLogger(Api.class);
    private static final int MAX_BODY_BYTES = 1024 * 1024;
    private static final int MAX_ARTWORK_CHARS = 760_000;
    private static final Pattern EMBEDDED_ARTWORK = Pattern.compile(
            "data:image/(?:png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/]+={0,2}",
            Pattern.CASE_INSENSITIVE);
    private static final Set<String> PROVIDERS = Set.of("soundcloud", "yandex", "local");
    private static final String LOCAL_PLAYLIST = "Мои треки";
    private static final String CORE_VERSION = "0.1.0";
    private static final Set<String> SETTINGS_KEYS = Set.of(
            "volume", "quality", "shuffle", "repeat", "reduceMotion", "genre", "theme", "windowButtons",
            "blur");
    private static final List<String> GENRES = List.of(
            "pop", "rock", "hiphop", "electronic", "indie", "jazz", "rnb", "classical");

    private final String token;
    private final Db db;
    private final Accounts accounts;
    private final Providers providers;
    private final StreamService streams;
    private final LocalLibrary localLibrary;
    private final LyricsService lyrics;
    private final Deque<Long> searchCalls = new ArrayDeque<>();
    private HttpServer server;
    private volatile int port;

    public Api(String token, Db db, Providers providers, StreamService streams, LocalLibrary localLibrary,
               LyricsService lyrics) {
        this.token = token;
        this.db = db;
        this.accounts = new Accounts(db);
        this.providers = providers;
        this.streams = streams;
        this.localLibrary = localLibrary;
        this.lyrics = lyrics;
    }

    public int start() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 32);
        server.createContext("/", this::handle);
        server.setExecutor(Executors.newFixedThreadPool(12, runnable -> {
            Thread thread = new Thread(runnable, "sofy-http");
            thread.setDaemon(true);
            return thread;
        }));
        server.start();
        port = server.getAddress().getPort();
        streams.setPort(port);
        return port;
    }

    public void stop() {
        if (server != null) server.stop(0);
    }

    private void handle(HttpExchange exchange) {
        try {
            if (!exchange.getRemoteAddress().getAddress().isLoopbackAddress()
                    || !hostAllowed(exchange)) {
                sendError(exchange, 403, "Forbidden");
                return;
            }
            String origin = exchange.getRequestHeaders().getFirst("Origin");
            if (origin != null && !originAllowed(origin)) {
                sendError(exchange, 403, "Forbidden");
                return;
            }

            String path = exchange.getRequestURI().getPath();
            if (path == null) path = "/";

            if (path.startsWith("/stream/")) {
                if (!get(exchange) && !head(exchange)) {
                    sendError(exchange, 405, "Метод не разрешён");
                    return;
                }
                String ticket = path.substring("/stream/".length());
                if (!ticket.matches("[A-Za-z0-9_-]{16,64}")) {
                    sendError(exchange, 404, "Поток не найден");
                    return;
                }
                streams.serve(ticket, exchange);
                return;
            }

            if (path.startsWith("/hls/")) {
                if (!get(exchange) && !head(exchange) && !options(exchange)) {
                    sendError(exchange, 405, "Метод не разрешён");
                    return;
                }
                String rest = path.substring("/hls/".length());
                int slash = rest.indexOf('/');
                if (slash <= 0 || slash == rest.length() - 1) {
                    sendError(exchange, 404, "HLS: не найдено");
                    return;
                }
                String ticket = rest.substring(0, slash);
                String subPath = rest.substring(slash + 1);
                if (!ticket.matches("[A-Za-z0-9_-]{16,64}")) {
                    sendError(exchange, 404, "HLS: не найдено");
                    return;
                }
                streams.serveHls(ticket, subPath, exchange);
                return;
            }

            if (!path.startsWith("/api/")) {
                sendError(exchange, 404, "Not found");
                return;
            }
            requireAuth(exchange);
            route(exchange, path);
        } catch (ApiException e) {
            sendError(exchange, e.status(), e.getMessage());
        } catch (IllegalArgumentException e) {
            sendError(exchange, 400, e.getMessage() == null ? "Некорректный запрос" : e.getMessage());
        } catch (Exception e) {
            log.error("request failed: {} {}", exchange.getRequestMethod(), exchange.getRequestURI(), e);
            sendError(exchange, 500, "Внутренняя ошибка ядра");
        } finally {
            exchange.close();
        }
    }

    private void route(HttpExchange exchange, String path) {
        if (path.equals("/api/health")) {
            requireMethod(exchange, "GET");
            Map<String, Object> health = new LinkedHashMap<>();
            health.put("ok", true);
            health.put("name", "SoFy Core");
            health.put("version", CORE_VERSION);
            health.put("uptimeMs", ProcessHandle.current().info().startInstant()
                    .map(start -> System.currentTimeMillis() - start.toEpochMilli()).orElse(0L));
            sendJson(exchange, 200, health);
            return;
        }
        if (path.equals("/api/accounts/register")) {
            requireMethod(exchange, "POST");
            JsonNode body = readBody(exchange);
            String username = requiredText(body, "username", 40);
            String displayName = optionalText(body, "displayName", 40);
            String password = requiredRawText(body, "password", 128);
            String accessKey = optionalText(body, "accessKey", 40);
            sendJson(exchange, 200, accounts.register(username, displayName, password, accessKey));
            return;
        }
        if (path.equals("/api/accounts/login")) {
            requireMethod(exchange, "POST");
            JsonNode body = readBody(exchange);
            String username = requiredText(body, "username", 40);
            String password = requiredRawText(body, "password", 128);
            sendJson(exchange, 200, accounts.login(username, password));
            return;
        }
        if (path.equals("/api/accounts/me")) {
            requireMethod(exchange, "GET");
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("account", accounts.session(accountToken(exchange)).orElse(null));
            sendJson(exchange, 200, payload);
            return;
        }
        if (path.equals("/api/accounts/profile")) {
            requireMethod(exchange, "PUT");
            String session = accountToken(exchange);
            if (accounts.session(session).isEmpty()) {
                throw new ApiException(401, "Требуется вход в аккаунт");
            }
            JsonNode body = readBody(exchange);
            String displayName = optionalText(body, "displayName", 40);
            String avatar = null;
            if (body.has("avatar")) {
                JsonNode node = body.get("avatar");
                if (node != null && !node.isNull() && !node.isTextual()) {
                    throw new ApiException(400, "Некорректное изображение профиля");
                }
                avatar = node == null || node.isNull() ? null : node.asText();
            }
            Accounts.Account account = accounts.updateProfile(
                    session, body.has("displayName"), displayName, body.has("avatar"), avatar);
            sendJson(exchange, 200, Map.of("account", account));
            return;
        }
        if (path.equals("/api/accounts/logout")) {
            requireMethod(exchange, "POST");
            accounts.logout(accountToken(exchange));
            sendJson(exchange, 200, Map.of("ok", true));
            return;
        }
        if (path.equals("/api/accounts/redeem")) {
            requireMethod(exchange, "POST");
            String key = requiredText(readBody(exchange), "key", 40);
            sendJson(exchange, 200,
                    Map.of("account", accounts.redeemAccessKey(accountToken(exchange), key)));
            return;
        }
        if (path.equals("/api/admin/overview")) {
            requireMethod(exchange, "GET");
            sendJson(exchange, 200, accounts.adminOverview(accountToken(exchange)));
            return;
        }
        if (path.equals("/api/admin/keys")) {
            if (post(exchange)) {
                JsonNode body = readBody(exchange);
                String role = requiredText(body, "role", 16);
                String note = optionalText(body, "note", 60);
                sendJson(exchange, 200,
                        accounts.createAccessKey(accountToken(exchange), role, note));
                return;
            }
            throw new ApiException(405, "Метод не разрешён");
        }
        if (path.startsWith("/api/admin/keys/")) {
            requireMethod(exchange, "DELETE");
            String id = path.substring("/api/admin/keys/".length());
            validateUuid(id);
            accounts.revokeAccessKey(accountToken(exchange), id);
            sendJson(exchange, 200, Map.of("ok", true));
            return;
        }
        if (path.startsWith("/api/admin/accounts/") && path.endsWith("/role")) {
            requireMethod(exchange, "PUT");
            String id = path.substring("/api/admin/accounts/".length(),
                    path.length() - "/role".length());
            validateUuid(id);
            String role = requiredText(readBody(exchange), "role", 16);
            sendJson(exchange, 200,
                    Map.of("account", accounts.setRole(accountToken(exchange), id, role)));
            return;
        }
        if (path.equals("/api/home")) {
            requireMethod(exchange, "GET");
            sendJson(exchange, 200, home());
            return;
        }
        if (path.equals("/api/search")) {
            requireMethod(exchange, "GET");
            sendJson(exchange, 200, search(exchange));
            return;
        }
        if (path.startsWith("/api/tracks/") && path.endsWith("/ticket")) {
            requireMethod(exchange, "GET");
            String id = path.substring("/api/tracks/".length(), path.length() - "/ticket".length());
            validateTrackId(id);
            sendJson(exchange, 200, streams.issue(id));
            return;
        }
        if (path.startsWith("/api/tracks/") && path.endsWith("/lyrics")) {
            requireMethod(exchange, "GET");
            String id = path.substring("/api/tracks/".length(), path.length() - "/lyrics".length());
            validateTrackId(id);
            sendJson(exchange, 200, lyrics.fetch(id));
            return;
        }
        if (path.startsWith("/api/tracks/") && path.endsWith("/cover")) {
            requireMethod(exchange, "PUT");
            String id = path.substring("/api/tracks/".length(), path.length() - "/cover".length());
            validateTrackId(id);
            Track track = db.getTrack(id).orElseThrow(() -> new ApiException(404, "Трек не найден"));
            if (!track.provider().equals("local")) {
                throw new ApiException(400, "Обложку можно изменить только у своих треков");
            }
            JsonNode body = readBody(exchange);
            String cover = null;
            if (body.has("cover")) {
                String raw = optionalText(body, "cover", MAX_ARTWORK_CHARS);
                if (raw != null) cover = requireArtwork(raw);
            }
            db.setTrackCover(id, cover);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("ok", true);
            result.put("cover", cover);
            sendJson(exchange, 200, result);
            return;
        }
        if (path.equals("/api/library/likes")) {
            if (get(exchange)) {
                sendJson(exchange, 200, Map.of("tracks", db.likes(200)));
                return;
            }
            if (post(exchange)) {
                Track track = trackFrom(readBody(exchange).path("track"));
                db.like(track);
                sendJson(exchange, 200, Map.of("liked", true, "track", track));
                return;
            }
            throw new ApiException(405, "Метод не разрешён");
        }
        if (path.startsWith("/api/library/likes/")) {
            requireMethod(exchange, "DELETE");
            String id = path.substring("/api/library/likes/".length());
            validateTrackId(id);
            db.unlike(id);
            sendJson(exchange, 200, Map.of("liked", false));
            return;
        }
        if (path.equals("/api/library/import")) {
            requireMethod(exchange, "POST");
            String filePath = requiredText(readBody(exchange), "path", 4096);
            Track track = localLibrary.importFile(filePath);
            Db.Playlist playlist = db.ensurePlaylist(LOCAL_PLAYLIST);
            db.addPlaylistTrack(playlist.id(), track);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("track", track);
            result.put("playlistId", playlist.id());
            result.put("playlistName", playlist.name());
            sendJson(exchange, 200, result);
            return;
        }
        if (path.equals("/api/library/history")) {
            if (get(exchange)) {
                int limit = clamp(parseInt(queryParam(exchange, "limit"), 40), 1, 100);
                sendJson(exchange, 200, Map.of("tracks", db.history(limit)));
                return;
            }
            if (post(exchange)) {
                Track track = trackFrom(readBody(exchange).path("track"));
                db.addHistory(track);
                sendJson(exchange, 200, Map.of("ok", true));
                return;
            }
            throw new ApiException(405, "Метод не разрешён");
        }
        if (path.equals("/api/playlists")) {
            if (get(exchange)) {
                sendJson(exchange, 200, Map.of("playlists", playlistCards()));
                return;
            }
            if (post(exchange)) {
                String name = requiredText(readBody(exchange), "name", 80);
                Db.Playlist playlist = db.createPlaylist(name);
                sendJson(exchange, 200, Map.of("playlist", playlist));
                return;
            }
            throw new ApiException(405, "Метод не разрешён");
        }
        if (path.startsWith("/api/playlists/")) {
            String rest = path.substring("/api/playlists/".length());
            String[] parts = rest.split("/");
            String playlistId = parts[0];
            validatePlaylistId(playlistId);

            if (parts.length == 1) {
                if (get(exchange)) {
                    Db.Playlist playlist = db.playlist(playlistId)
                            .orElseThrow(() -> new ApiException(404, "Плейлист не найден"));
                    List<Track> tracks = db.playlistTracks(playlistId);
                    Map<String, Object> result = new LinkedHashMap<>();
                    result.put("playlist", playlist);
                    result.put("trackCount", tracks.size());
                    result.put("tracks", tracks);
                    sendJson(exchange, 200, result);
                    return;
                }
                if (put(exchange)) {
                    Db.Playlist current = db.playlist(playlistId)
                            .orElseThrow(() -> new ApiException(404, "Плейлист не найден"));
                    JsonNode body = readBody(exchange);
                    String cover = current.cover();
                    if (body.has("cover")) {
                        String raw = optionalText(body, "cover", MAX_ARTWORK_CHARS);
                        cover = raw == null ? null : requireArtwork(raw);
                    }
                    String description = current.description();
                    if (body.has("description")) {
                        JsonNode node = body.get("description");
                        if (node == null || node.isNull()) {
                            description = null;
                        } else if (!node.isTextual()) {
                            throw new ApiException(400, "Описание должно быть строкой");
                        } else {
                            String text = node.asText().replace("\u0000", "").trim();
                            if (text.length() > 300) {
                                throw new ApiException(400, "Описание не должно превышать 300 символов");
                            }
                            description = text.isEmpty() ? null : text;
                        }
                    }
                    db.updatePlaylistMeta(playlistId, cover, description);
                    sendJson(exchange, 200, Map.of("playlist",
                            db.playlist(playlistId).orElseThrow()));
                    return;
                }
                if (delete(exchange)) {
                    db.deletePlaylist(playlistId);
                    sendJson(exchange, 200, Map.of("ok", true));
                    return;
                }
                throw new ApiException(405, "Метод не разрешён");
            }
            if (parts.length == 2 && parts[1].equals("tracks")) {
                requireMethod(exchange, "POST");
                db.playlist(playlistId)
                        .orElseThrow(() -> new ApiException(404, "Плейлист не найден"));
                Track track = trackFrom(readBody(exchange).path("track"));
                db.addPlaylistTrack(playlistId, track);
                sendJson(exchange, 200, Map.of("ok", true));
                return;
            }
            if (parts.length == 3 && parts[1].equals("tracks")) {
                requireMethod(exchange, "DELETE");
                validateTrackId(parts[2]);
                db.removePlaylistTrack(playlistId, parts[2]);
                sendJson(exchange, 200, Map.of("ok", true));
                return;
            }
        }
        if (path.equals("/api/settings")) {
            if (get(exchange)) {
                sendJson(exchange, 200, Map.of("settings", db.settings()));
                return;
            }
            if (put(exchange)) {
                JsonNode body = readBody(exchange);
                updateSetting(body);
                sendJson(exchange, 200, Map.of("settings", db.settings()));
                return;
            }
            throw new ApiException(405, "Метод не разрешён");
        }
        if (path.equals("/api/providers")) {
            requireMethod(exchange, "GET");
            sendJson(exchange, 200, Map.of("providers", providers.status()));
            return;
        }
        if (path.startsWith("/api/providers/") && path.endsWith("/credentials")) {
            String id = path.substring("/api/providers/".length(), path.length() - "/credentials".length());
            if (put(exchange)) {
                JsonNode body = readBody(exchange);
                String credential = requiredText(body, "credential", 4096);
                try {
                    providers.setCredential(id, credential);
                } catch (ProviderException e) {
                    throw new ApiException(400, e.getMessage());
                }
                sendJson(exchange, 200, Map.of("providers", providers.status()));
                return;
            }
            if (delete(exchange)) {
                providers.clearCredential(id);
                sendJson(exchange, 200, Map.of("providers", providers.status()));
                return;
            }
            throw new ApiException(405, "Метод не разрешён");
        }
        throw new ApiException(404, "Not found");
    }

    private Map<String, Object> home() {
        List<Track> recent = db.history(20);
        List<Track> liked = db.likes(50);

        List<Map<String, Object>> shelves = new ArrayList<>();
        if (!recent.isEmpty()) {
            shelves.add(shelf("recent", "Недавно слушали", "Продолжите с того места", recent));
        }
        if (!liked.isEmpty()) {
            shelves.add(shelf("liked", "Мне нравится", "Ваша коллекция", liked));
        }

        Track hero = !recent.isEmpty() ? recent.get(0) : liked.isEmpty() ? null : liked.get(0);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("heroTrack", hero);
        result.put("shelves", shelves);
        result.put("genres", genres());
        return result;
    }

    private static List<Map<String, Object>> genres() {
        List<Map<String, Object>> result = new ArrayList<>();
        result.add(genre("pop", "Поп", "pop music", "#f0b64f"));
        result.add(genre("rock", "Рок", "rock music", "#ef5d6a"));
        result.add(genre("hiphop", "Хип-хоп", "hip hop", "#8f7bff"));
        result.add(genre("electronic", "Электроника", "electronic music", "#3fc1c9"));
        result.add(genre("indie", "Инди", "indie music", "#7fcf7a"));
        result.add(genre("jazz", "Джаз", "jazz music", "#e0a15c"));
        result.add(genre("rnb", "R&B", "r&b music", "#d77fa8"));
        result.add(genre("classical", "Классика", "classical music", "#a9b7d0"));
        return result;
    }

    private static Map<String, Object> genre(String id, String label, String query, String color) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", id);
        map.put("label", label);
        map.put("query", query);
        map.put("color", color);
        return map;
    }

    private static Map<String, Object> shelf(String id, String title, String subtitle, List<Track> tracks) {
        Map<String, Object> shelf = new LinkedHashMap<>();
        shelf.put("id", id);
        shelf.put("title", title);
        shelf.put("subtitle", subtitle);
        shelf.put("tracks", tracks);
        return shelf;
    }

    private List<Map<String, Object>> playlistCards() {
        List<Db.Playlist> playlists = db.playlists();
        Map<String, Integer> counts = db.playlistTrackCounts();
        Map<String, List<Track>> previews = db.playlistPreviews(4);
        List<Map<String, Object>> cards = new ArrayList<>();
        for (Db.Playlist playlist : playlists) {
            Map<String, Object> card = new LinkedHashMap<>();
            card.put("id", playlist.id());
            card.put("name", playlist.name());
            card.put("cover", playlist.cover());
            card.put("description", playlist.description());
            card.put("trackCount", counts.getOrDefault(playlist.id(), 0));
            card.put("updatedAt", playlist.updatedAt());
            card.put("preview", previews.getOrDefault(playlist.id(), List.of()));
            cards.add(card);
        }
        return cards;
    }

    private Map<String, Object> search(HttpExchange exchange) {
        String query = queryParam(exchange, "q");
        query = query == null ? "" : query.trim();
        if (query.length() > 120) throw new ApiException(400, "Слишком длинный запрос");
        String provider = queryParam(exchange, "provider");
        if (provider == null || provider.isBlank()) provider = "all";
        if (!provider.equals("all") && !PROVIDERS.contains(provider)) {
            throw new ApiException(400, "Неизвестный источник");
        }
        int limit = clamp(parseInt(queryParam(exchange, "limit"), 50), 1, 50);
        int offset = clamp(parseInt(queryParam(exchange, "offset"), 0), 0, 5000);
        if (query.isEmpty()) {
            return Map.of("tracks", List.of(), "errors", List.of());
        }
        checkSearchRate();
        Providers.SearchOutcome outcome = providers.search(query, provider, limit, offset);
        if (!outcome.tracks().isEmpty()) {
            db.upsertTracks(outcome.tracks());
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("tracks", outcome.tracks());
        result.put("errors", outcome.errors());
        return result;
    }

    private void updateSetting(JsonNode body) {
        String key = requiredText(body, "key", 40);
        if (!SETTINGS_KEYS.contains(key)) throw new ApiException(400, "Неизвестная настройка");
        JsonNode valueNode = body.get("value");
        if (valueNode == null || valueNode.isNull() || valueNode.isContainerNode()) {
            throw new ApiException(400, "Некорректное значение настройки");
        }
        String value = valueNode.asText().trim();
        if (value.length() > 40) throw new ApiException(400, "Слишком длинное значение");

        switch (key) {
            case "volume" -> {
                try {
                    double volume = Double.parseDouble(value);
                    if (volume < 0 || volume > 1) throw new NumberFormatException();
                    value = Double.toString(volume);
                } catch (NumberFormatException e) {
                    throw new ApiException(400, "Громкость должна быть от 0 до 1");
                }
            }
            case "quality" -> {
                if (!Set.of("low", "normal", "high", "lossless").contains(value)) {
                    throw new ApiException(400, "Неизвестное качество звука");
                }
            }
            case "repeat" -> {
                if (!Set.of("off", "all", "one").contains(value)) {
                    throw new ApiException(400, "Неизвестный режим повтора");
                }
            }
            case "genre" -> {
                if (!GENRES.contains(value)) {
                    throw new ApiException(400, "Неизвестный жанр");
                }
            }
            case "theme" -> {
                if (!Set.of("aurora", "arctic", "emerald", "ocean", "rose", "mono", "dawn", "frost").contains(value)) {
                    throw new ApiException(400, "Неизвестная тема");
                }
            }
            case "windowButtons" -> {
                if (!Set.of("right", "left").contains(value)) {
                    throw new ApiException(400, "Неизвестное расположение кнопок окна");
                }
            }
            case "blur" -> {
                if (!Set.of("off", "soft", "strong").contains(value)) {
                    throw new ApiException(400, "Неизвестный уровень размытия");
                }
            }
            case "shuffle", "reduceMotion" -> {
                if (!value.equals("true") && !value.equals("false")) {
                    throw new ApiException(400, "Ожидалось true или false");
                }
            }
            default -> throw new ApiException(400, "Неизвестная настройка");
        }
        db.setSetting(key, value);
    }

    private Track trackFrom(JsonNode node) {
        if (node == null || !node.isObject()) {
            throw new ApiException(400, "Не передан трек");
        }
        String provider = requiredText(node, "provider", 32);
        if (!PROVIDERS.contains(provider)) throw new ApiException(400, "Неизвестный источник трека");
        String externalId = requiredText(node, "externalId", 160);
        if (!externalId.matches("[A-Za-z0-9._:-]{1,160}")) {
            throw new ApiException(400, "Некорректный идентификатор трека");
        }
        String title = requiredText(node, "title", 300);
        String artist = requiredText(node, "artist", 300);
        String album = optionalText(node, "album", 300);
        long durationMs = node.path("durationMs").asLong(0);
        if (durationMs < 0 || durationMs > 86_400_000L) durationMs = 0;
        String artwork = optionalText(node, "artworkUrl", MAX_ARTWORK_CHARS);
        if (artwork != null) {
            artwork = sanitizeArtwork(artwork);
        }
        String color = optionalText(node, "color", 7);
        if (color != null && !color.matches("#[0-9a-fA-F]{6}")) color = null;
        boolean preview = node.path("preview").asBoolean(false);
        boolean streamable = node.path("streamable").asBoolean(true);
        return new Track(provider + ":" + externalId, provider, externalId, title, artist, album,
                durationMs, artwork, color, preview, streamable);
    }

    private static String sanitizeArtwork(String artwork) {
        if (artwork == null) return null;
        String lower = artwork.toLowerCase(Locale.ROOT);
        boolean remote = artwork.length() <= 2048
                && (lower.startsWith("https://") || lower.startsWith("http://"))
                && !artwork.contains("\n") && !artwork.contains("\r");
        boolean embedded = lower.startsWith("data:image/")
                && EMBEDDED_ARTWORK.matcher(artwork).matches();
        return remote || embedded ? artwork : null;
    }

    private static String requireArtwork(String artwork) {
        String clean = sanitizeArtwork(artwork);
        if (clean == null) throw new ApiException(400, "Некорректное изображение");
        return clean;
    }

    private JsonNode readBody(HttpExchange exchange) {
        try {
            long declared = parseLong(exchange.getRequestHeaders().getFirst("Content-Length"), 0);
            if (declared > MAX_BODY_BYTES) throw new ApiException(413, "Запрос слишком большой");
            byte[] data = exchange.getRequestBody().readNBytes(MAX_BODY_BYTES + 1);
            if (data.length > MAX_BODY_BYTES) throw new ApiException(413, "Запрос слишком большой");
            if (data.length == 0) return Json.MAPPER.createObjectNode();
            JsonNode node = Json.parse(new String(data, StandardCharsets.UTF_8));
            if (!node.isObject()) throw new ApiException(400, "Ожидался JSON-объект");
            return node;
        } catch (IOException e) {
            throw new ApiException(400, "Не удалось прочитать запрос");
        }
    }

    private void requireAuth(HttpExchange exchange) {
        String auth = exchange.getRequestHeaders().getFirst("Authorization");
        byte[] expected = ("Bearer " + token).getBytes(StandardCharsets.UTF_8);
        if (auth == null || !MessageDigest.isEqual(auth.getBytes(StandardCharsets.UTF_8), expected)) {
            throw new ApiException(401, "Требуется авторизация");
        }
    }

    private boolean hostAllowed(HttpExchange exchange) {
        String host = exchange.getRequestHeaders().getFirst("Host");
        int currentPort = port;
        return host != null && currentPort > 0
                && (host.equals("127.0.0.1:" + currentPort) || host.equals("localhost:" + currentPort));
    }

    private static boolean originAllowed(String origin) {
        return origin.equals("null")
                || origin.startsWith("file://")
                || origin.startsWith("http://localhost:")
                || origin.startsWith("http://127.0.0.1:");
    }

    private void checkSearchRate() {
        long now = System.currentTimeMillis();
        synchronized (searchCalls) {
            while (!searchCalls.isEmpty() && now - searchCalls.peekFirst() > 10_000) {
                searchCalls.pollFirst();
            }
            if (searchCalls.size() >= 15) {
                throw new ApiException(429, "Слишком много запросов. Подождите пару секунд.");
            }
            searchCalls.addLast(now);
        }
    }

    private static void requireMethod(HttpExchange exchange, String method) {
        if (!exchange.getRequestMethod().equalsIgnoreCase(method)) {
            throw new ApiException(405, "Метод не разрешён");
        }
    }

    private static boolean get(HttpExchange exchange) {
        return exchange.getRequestMethod().equalsIgnoreCase("GET");
    }

    private static boolean head(HttpExchange exchange) {
        return exchange.getRequestMethod().equalsIgnoreCase("HEAD");
    }

    private static boolean options(HttpExchange exchange) {
        return exchange.getRequestMethod().equalsIgnoreCase("OPTIONS");
    }

    private static boolean post(HttpExchange exchange) {
        return exchange.getRequestMethod().equalsIgnoreCase("POST");
    }

    private static boolean put(HttpExchange exchange) {
        return exchange.getRequestMethod().equalsIgnoreCase("PUT");
    }

    private static boolean delete(HttpExchange exchange) {
        return exchange.getRequestMethod().equalsIgnoreCase("DELETE");
    }

    private static String queryParam(HttpExchange exchange, String name) {
        String raw = exchange.getRequestURI().getRawQuery();
        if (raw == null || raw.isEmpty()) return null;
        for (String part : raw.split("&")) {
            int eq = part.indexOf('=');
            String key = eq >= 0 ? part.substring(0, eq) : part;
            if (key.equals(name)) {
                String value = eq >= 0 ? part.substring(eq + 1) : "";
                return URLDecoder.decode(value, StandardCharsets.UTF_8);
            }
        }
        return null;
    }

    private static void validateTrackId(String id) {
        if (!id.matches("[a-z]{3,16}:[A-Za-z0-9._:-]{1,160}")) {
            throw new ApiException(400, "Некорректный идентификатор трека");
        }
    }

    private static void validatePlaylistId(String id) {
        if (!id.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")) {
            throw new ApiException(400, "Некорректный идентификатор плейлиста");
        }
    }

    private static void validateUuid(String id) {
        if (!id.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")) {
            throw new ApiException(400, "Некорректный идентификатор");
        }
    }

    private static String requiredText(JsonNode node, String field, int max) {
        String value = optionalText(node, field, max);
        if (value == null) throw new ApiException(400, "Поле " + field + " обязательно");
        return value;
    }

    private static String requiredRawText(JsonNode node, String field, int max) {
        if (node == null) throw new ApiException(400, "Поле " + field + " обязательно");
        JsonNode value = node.get(field);
        if (value == null || value.isNull() || !value.isTextual()) {
            throw new ApiException(400, "Поле " + field + " обязательно");
        }
        String text = value.asText();
        if (text.isEmpty()) throw new ApiException(400, "Поле " + field + " обязательно");
        if (text.length() > max) throw new ApiException(400, "Поле " + field + " слишком длинное");
        return text;
    }

    private static String accountToken(HttpExchange exchange) {
        String value = exchange.getRequestHeaders().getFirst("X-SoFy-Session");
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String optionalText(JsonNode node, String field, int max) {
        if (node == null) return null;
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) return null;
        if (!value.isTextual()) throw new ApiException(400, "Поле " + field + " должно быть строкой");
        String text = value.asText().replace("\u0000", "").trim();
        if (text.isEmpty()) return null;
        if (text.length() > max) throw new ApiException(400, "Поле " + field + " слишком длинное");
        return text;
    }

    private static int parseInt(String value, int fallback) {
        if (value == null) return fallback;
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static long parseLong(String value, long fallback) {
        if (value == null) return fallback;
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private static void sendJson(HttpExchange exchange, int status, Object payload) {
        byte[] bytes = Json.write(payload).getBytes(StandardCharsets.UTF_8);
        var headers = exchange.getResponseHeaders();
        headers.set("Content-Type", "application/json; charset=utf-8");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Cache-Control", "no-store");
        try {
            exchange.sendResponseHeaders(status, bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        } catch (IOException ignored) {
            // client disconnected
        }
    }

    private static void sendError(HttpExchange exchange, int status, String message) {
        byte[] bytes = Json.write(Map.of("error", message == null ? "Ошибка" : message))
                .getBytes(StandardCharsets.UTF_8);
        var headers = exchange.getResponseHeaders();
        headers.set("Content-Type", "application/json; charset=utf-8");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Cache-Control", "no-store");
        try {
            exchange.sendResponseHeaders(status, bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        } catch (IOException ignored) {
            // response already committed or client gone
        }
    }
}
