package ru.sofy.core;

import com.sun.net.httpserver.HttpExchange;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import ru.sofy.core.providers.MusicProvider;
import ru.sofy.core.providers.ProviderException;
import ru.sofy.core.providers.Providers;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/**
 * Short-lived per-track tickets let the audio element and hls.js fetch media
 * without ever seeing the API bearer token. Progressive streams are proxies
 * byte-for-byte; HLS playlists are rewritten so every nested request stays on
 * the loopback proxy (this also sidesteps CORS and hotlink protections).
 */
public final class StreamService {
    private static final Logger log = LoggerFactory.getLogger(StreamService.class);
    private static final long PROGRESSIVE_TTL_MS = 15 * 60_000L;
    private static final long HLS_TTL_MS = 30 * 60_000L;
    private static final int MAX_TICKETS = 512;
    private static final int MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;
    private static final Pattern URI_ATTRIBUTE = Pattern.compile("URI=\"([^\"]+)\"");

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();
    private static final String UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 SoFy/0.1";

    private final Db db;
    private final Providers providers;
    private final Path musicDir;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Ticket> tickets = new ConcurrentHashMap<>();
    private final Semaphore streamSlots = new Semaphore(4, true);
    private final Semaphore hlsSlots = new Semaphore(10, true);
    private volatile int port;

    public StreamService(Db db, Providers providers, Path musicDir) {
        this.db = db;
        this.providers = providers;
        this.musicDir = musicDir.toAbsolutePath().normalize();
    }

    public void setPort(int port) {
        this.port = port;
    }

    // ------------------------------------------------------------------ tickets

    public Map<String, Object> issue(String trackId) {
        Track track = db.getTrack(trackId)
                .orElseThrow(() -> new ApiException(404, "Трек не найден"));
        MusicProvider provider = providers.get(track.provider());
        if (provider == null) throw new ApiException(400, "Неизвестный источник трека");
        if (!provider.isConfigured()) throw new ApiException(409, "Источник не подключён");
        if (!track.streamable()) throw new ApiException(451, "Трек недоступен для воспроизведения");

        MusicProvider.Prepared prepared;
        try {
            prepared = provider.prepare(track);
        } catch (ProviderException e) {
            throw new ApiException(502, e.getMessage());
        }

        purgeExpired();
        if (tickets.size() >= MAX_TICKETS) {
            throw new ApiException(429, "Слишком много одновременных потоков");
        }
        byte[] raw = new byte[24];
        random.nextBytes(raw);
        String ticketId = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        boolean hls = "hls".equals(prepared.kind());
        long ttl = hls ? HLS_TTL_MS : PROGRESSIVE_TTL_MS;
        long expiresAt = System.currentTimeMillis() + ttl;
        tickets.put(ticketId, new Ticket(trackId, prepared.kind(), prepared.url(), expiresAt));

        String url = hls
                ? "http://127.0.0.1:" + port + "/hls/" + ticketId + "/master.m3u8"
                : "http://127.0.0.1:" + port + "/stream/" + ticketId;

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("url", url);
        result.put("kind", prepared.kind());
        result.put("expiresAt", expiresAt);
        return result;
    }

    private void purgeExpired() {
        long now = System.currentTimeMillis();
        tickets.entrySet().removeIf(entry -> entry.getValue().expiresAt < now);
    }

    private Ticket validTicket(String ticketId) {
        Ticket ticket = tickets.get(ticketId);
        if (ticket == null || ticket.expiresAt < System.currentTimeMillis()) return null;
        return ticket;
    }

    // ------------------------------------------------------------------- stream

    public void serve(String ticketId, HttpExchange exchange) throws IOException {
        boolean head = "HEAD".equalsIgnoreCase(exchange.getRequestMethod());
        Ticket ticket = validTicket(ticketId);
        if (ticket == null) {
            sendText(exchange, 404, "Поток истёк");
            return;
        }
        if ("hls".equals(ticket.kind)) {
            sendText(exchange, 404, "Поток открывается через HLS");
            return;
        }
        Track track = db.getTrack(ticket.trackId).orElse(null);
        if (track == null) {
            sendText(exchange, 404, "Трек не найден");
            return;
        }
        if ("file".equals(ticket.kind)) {
            serveFile(ticket.upstreamUrl, exchange, head);
            return;
        }
        MusicProvider provider = providers.get(track.provider());
        if (provider == null || !provider.isConfigured()) {
            sendText(exchange, 503, "Источник недоступен");
            return;
        }

        boolean acquired = false;
        MusicProvider.Upstream upstream = null;
        try {
            acquired = streamSlots.tryAcquire(5, TimeUnit.SECONDS);
            if (!acquired) {
                sendText(exchange, 503, "Слишком много потоков");
                return;
            }
            String range = exchange.getRequestHeaders().getFirst("Range");
            upstream = provider.open(track, new MusicProvider.Prepared(ticket.kind, ticket.upstreamUrl), range);

            var responseHeaders = exchange.getResponseHeaders();
            responseHeaders.set("X-Content-Type-Options", "nosniff");
            responseHeaders.set("Cache-Control", "no-store");
            for (Map.Entry<String, String> header : upstream.headers().entrySet()) {
                String name = header.getKey();
                if (name.equalsIgnoreCase("Content-Type")
                        || name.equalsIgnoreCase("Content-Length")
                        || name.equalsIgnoreCase("Content-Range")
                        || name.equalsIgnoreCase("Accept-Ranges")) {
                    responseHeaders.set(name, header.getValue());
                }
            }
            if (responseHeaders.getFirst("Content-Type") == null) {
                responseHeaders.set("Content-Type", "audio/mpeg");
            }

            int status = upstream.status();
            long length = -1;
            String contentLength = upstream.headers().get("Content-Length");
            if (contentLength != null) {
                try {
                    length = Long.parseLong(contentLength);
                } catch (NumberFormatException ignored) {
                    length = -1;
                }
            }

            if (head || status == 416) {
                exchange.sendResponseHeaders(status, -1);
                return;
            }
            exchange.sendResponseHeaders(status, length >= 0 ? length : 0);
            try (InputStream input = upstream.body(); OutputStream output = exchange.getResponseBody()) {
                copy(input, output);
            }
        } catch (ProviderException e) {
            log.warn("stream failed: {}", e.getMessage());
            try {
                sendText(exchange, 502, e.getMessage());
            } catch (IOException ignored) {
                // response may already be committed
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (IOException e) {
            // browser aborted the media request — normal when switching tracks
        } finally {
            if (upstream != null) upstream.close();
            if (acquired) streamSlots.release();
        }
    }

    // --------------------------------------------------------------- local files

    private void serveFile(String rawPath, HttpExchange exchange, boolean head) throws IOException {
        Path file;
        try {
            file = Path.of(rawPath).toAbsolutePath().normalize();
        } catch (RuntimeException e) {
            sendText(exchange, 404, "Файл не найден");
            return;
        }
        if (!file.startsWith(musicDir) || !Files.isRegularFile(file)) {
            sendText(exchange, 404, "Файл не найден");
            return;
        }
        long size = Files.size(file);
        var headers = exchange.getResponseHeaders();
        headers.set("Accept-Ranges", "bytes");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Cache-Control", "no-store");
        headers.set("Content-Type", contentType(file.getFileName().toString()));

        String rangeHeader = exchange.getRequestHeaders().getFirst("Range");
        long[] range = parseRange(rangeHeader, size);
        long start = 0;
        long end = size > 0 ? size - 1 : 0;
        int status = 200;
        if (range != null) {
            if (range[0] < 0) {
                headers.set("Content-Range", "bytes */" + size);
                exchange.sendResponseHeaders(416, -1);
                return;
            }
            start = range[0];
            end = range[1];
            status = 206;
            headers.set("Content-Range", "bytes " + start + "-" + end + "/" + size);
        }

        long length = Math.max(0, end - start + 1);
        if (head) {
            exchange.sendResponseHeaders(status, -1);
            return;
        }
        exchange.sendResponseHeaders(status, length);
        try (RandomAccessFile input = new RandomAccessFile(file.toFile(), "r");
             OutputStream output = exchange.getResponseBody()) {
            input.seek(start);
            byte[] buffer = new byte[64 * 1024];
            long remaining = length;
            while (remaining > 0) {
                int read = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                if (read < 0) break;
                output.write(buffer, 0, read);
                remaining -= read;
            }
            output.flush();
        } catch (IOException ignored) {
            // browser aborted the media request — expected while seeking
        }
    }

    private static long[] parseRange(String header, long size) {
        if (header == null || header.isBlank()) return null;
        if (!header.startsWith("bytes=")) return new long[]{-1, -1};
        String spec = header.substring("bytes=".length()).trim();
        int comma = spec.indexOf(',');
        if (comma >= 0) spec = spec.substring(0, comma).trim();
        int dash = spec.indexOf('-');
        if (dash < 0) return new long[]{-1, -1};
        try {
            if (dash == 0) {
                long suffix = Long.parseLong(spec.substring(1).trim());
                if (suffix <= 0) return new long[]{-1, -1};
                return new long[]{Math.max(0, size - suffix), Math.max(0, size - 1)};
            }
            long start = Long.parseLong(spec.substring(0, dash).trim());
            long end = dash == spec.length() - 1
                    ? size - 1
                    : Long.parseLong(spec.substring(dash + 1).trim());
            if (start < 0 || start >= size || start > end) return new long[]{-1, -1};
            return new long[]{start, Math.min(end, size - 1)};
        } catch (NumberFormatException e) {
            return new long[]{-1, -1};
        }
    }

    private static String contentType(String name) {
        int dot = name.lastIndexOf('.');
        String ext = dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
        return switch (ext) {
            case "mp3" -> "audio/mpeg";
            case "m4a", "mp4" -> "audio/mp4";
            case "aac" -> "audio/aac";
            case "flac" -> "audio/flac";
            case "ogg", "opus" -> "audio/ogg";
            case "wav" -> "audio/wav";
            case "webm" -> "audio/webm";
            default -> "application/octet-stream";
        };
    }

    // ---------------------------------------------------------------------- HLS

    public void serveHls(String ticketId, String subPath, HttpExchange exchange) throws IOException {
        boolean head = "HEAD".equalsIgnoreCase(exchange.getRequestMethod());
        addCors(exchange);
        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
            exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Range, Content-Type");
            exchange.getResponseHeaders().set("Access-Control-Max-Age", "600");
            exchange.sendResponseHeaders(204, -1);
            return;
        }

        Ticket ticket = validTicket(ticketId);
        if (ticket == null || !"hls".equals(ticket.kind)) {
            sendText(exchange, 404, "HLS-поток истёк");
            return;
        }
        boolean master = "master.m3u8".equals(subPath);
        String upstreamUrl;
        if (master) {
            upstreamUrl = ticket.upstreamUrl;
        } else if (subPath.startsWith("x/")) {
            upstreamUrl = decodeChildUrl(ticketId, subPath.substring(2));
            if (upstreamUrl == null) {
                sendText(exchange, 403, "Некорректный адрес HLS");
                return;
            }
        } else {
            sendText(exchange, 404, "HLS: не найдено");
            return;
        }

        boolean acquired = false;
        try {
            acquired = hlsSlots.tryAcquire(5, TimeUnit.SECONDS);
            if (!acquired) {
                sendText(exchange, 503, "Слишком много HLS-запросов");
                return;
            }

            HttpResponse<InputStream> response = fetchHls(upstreamUrl);
            if (master && isExpiredStatus(response.statusCode())) {
                response.body().close();
                Track track = db.getTrack(ticket.trackId).orElse(null);
                MusicProvider provider = track == null ? null : providers.get(track.provider());
                if (track != null && provider != null) {
                    try {
                        MusicProvider.Prepared fresh = provider.prepare(track);
                        if ("hls".equals(fresh.kind())) {
                            ticket.upstreamUrl = fresh.url();
                            upstreamUrl = fresh.url();
                            response = fetchHls(upstreamUrl);
                        }
                    } catch (ProviderException e) {
                        log.warn("HLS re-resolve failed: {}", e.getMessage());
                    }
                }
            }

            int status = response.statusCode();
            if (status >= 400) {
                response.body().close();
                sendText(exchange, status, "HLS CDN вернул ошибку " + status);
                return;
            }

            String contentType = response.headers().firstValue("Content-Type").orElse("application/octet-stream");
            boolean playlist = isPlaylist(upstreamUrl, contentType);
            if (head) {
                exchange.sendResponseHeaders(status, -1);
                response.body().close();
                return;
            }

            if (playlist) {
                InputStream body = response.body();
                String encoding = response.headers().firstValue("Content-Encoding").orElse("");
                if ("gzip".equalsIgnoreCase(encoding)) body = new GZIPInputStream(body);
                byte[] bytes;
                try (InputStream input = body) {
                    bytes = input.readNBytes(MAX_PLAYLIST_BYTES + 1);
                }
                if (bytes.length > MAX_PLAYLIST_BYTES) {
                    sendText(exchange, 502, "HLS-плейлист слишком большой");
                    return;
                }
                String text = new String(bytes, StandardCharsets.UTF_8);
                String rewritten = rewritePlaylist(text, upstreamUrl, ticketId);
                sendPlaylist(exchange, rewritten);
            } else {
                long length = response.headers().firstValueAsLong("Content-Length").orElse(-1);
                var headers = exchange.getResponseHeaders();
                headers.set("Content-Type", safeContentType(contentType));
                headers.set("X-Content-Type-Options", "nosniff");
                headers.set("Cache-Control", "no-store");
                response.headers().firstValue("Content-Encoding").ifPresent(v -> headers.set("Content-Encoding", v));
                exchange.sendResponseHeaders(status, length >= 0 ? length : 0);
                try (InputStream input = response.body(); OutputStream output = exchange.getResponseBody()) {
                    copy(input, output);
                }
            }
        } catch (ProviderException e) {
            log.warn("hls failed: {}", e.getMessage());
            try {
                sendText(exchange, 502, e.getMessage());
            } catch (IOException ignored) {
                // client disconnected
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (IOException e) {
            // hls.js aborted a segment request — expected while seeking
        } finally {
            if (acquired) hlsSlots.release();
        }
    }

    private HttpResponse<InputStream> fetchHls(String url) throws IOException, InterruptedException, ProviderException {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(25))
                    .header("User-Agent", UA)
                    .header("Accept", "*/*")
                    .header("Accept-Encoding", "identity")
                    .header("Referer", "https://soundcloud.com/")
                    .GET()
                    .build();
            return HTTP.send(request, HttpResponse.BodyHandlers.ofInputStream());
        } catch (IllegalArgumentException e) {
            throw new ProviderException("Некорректный HLS-адрес", e);
        }
    }

    private String decodeChildUrl(String ticketId, String encoded) {
        if (encoded.length() > 6144) return null;
        try {
            String decoded = new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8);
            if (decoded.length() > 4096) return null;
            URI uri = URI.create(decoded);
            if (!"https".equalsIgnoreCase(uri.getScheme())) return null;
            String host = uri.getHost();
            if (host == null) return null;
            host = host.toLowerCase(Locale.ROOT);
            boolean allowed = host.equals("sndcdn.com") || host.endsWith(".sndcdn.com")
                    || host.equals("soundcloud.com") || host.endsWith(".soundcloud.com")
                    || host.endsWith(".soundcloud.cloud");
            return allowed ? decoded : null;
        } catch (Exception e) {
            return null;
        }
    }

    private String rewritePlaylist(String playlist, String baseUrl, String ticketId) {
        URI base = URI.create(baseUrl);
        StringBuilder out = new StringBuilder(playlist.length() + 256);
        for (String line : playlist.split("\n", -1)) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) {
                out.append(line).append('\n');
                continue;
            }
            if (trimmed.startsWith("#")) {
                out.append(rewriteTag(line, base, ticketId));
            } else {
                out.append(localUrl(ticketId, base.resolve(trimmed).toString()));
            }
            out.append('\n');
        }
        return out.toString();
    }

    private String rewriteTag(String line, URI base, String ticketId) {
        Matcher matcher = URI_ATTRIBUTE.matcher(line);
        StringBuilder out = new StringBuilder();
        while (matcher.find()) {
            String value = matcher.group(1);
            String replacement = value;
            try {
                URI resolved = base.resolve(value);
                if (resolved.getScheme() != null
                        && (resolved.getScheme().equalsIgnoreCase("https")
                        || resolved.getScheme().equalsIgnoreCase("http"))) {
                    replacement = localUrl(ticketId, resolved.toString());
                }
            } catch (Exception ignored) {
                // leave unusual URI schemes (skd://, data:) untouched
            }
            matcher.appendReplacement(out, Matcher.quoteReplacement("URI=\"" + replacement + "\""));
        }
        matcher.appendTail(out);
        return out.toString();
    }

    private static String localUrl(String ticketId, String absoluteUrl) {
        String encoded = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(absoluteUrl.getBytes(StandardCharsets.UTF_8));
        return "/hls/" + ticketId + "/x/" + encoded;
    }

    private static boolean isPlaylist(String url, String contentType) {
        String lowerType = contentType == null ? "" : contentType.toLowerCase(Locale.ROOT);
        if (lowerType.contains("mpegurl")) return true;
        try {
            String path = URI.create(url).getPath();
            return path != null && path.toLowerCase(Locale.ROOT).endsWith(".m3u8");
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean isExpiredStatus(int status) {
        return status == 401 || status == 403 || status == 410;
    }

    private static String safeContentType(String contentType) {
        if (contentType == null) return "application/octet-stream";
        String lower = contentType.toLowerCase(Locale.ROOT);
        if (lower.startsWith("audio/") || lower.startsWith("video/")
                || lower.startsWith("application/octet-stream")
                || lower.startsWith("binary/octet-stream")
                || lower.startsWith("application/vnd.apple.mpegurl")) {
            return contentType;
        }
        return "application/octet-stream";
    }

    private static void addCors(HttpExchange exchange) {
        String origin = exchange.getRequestHeaders().getFirst("Origin");
        if (origin == null) return;
        if (origin.equals("null") || origin.startsWith("file://")
                || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
            exchange.getResponseHeaders().set("Access-Control-Allow-Origin", origin);
            exchange.getResponseHeaders().set("Vary", "Origin");
        }
    }

    private static void sendPlaylist(HttpExchange exchange, String playlist) throws IOException {
        byte[] bytes = playlist.getBytes(StandardCharsets.UTF_8);
        var headers = exchange.getResponseHeaders();
        headers.set("Content-Type", "application/vnd.apple.mpegurl");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        int read;
        while ((read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
        output.flush();
    }

    private static void sendText(HttpExchange exchange, int status, String message) throws IOException {
        byte[] bytes = message.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    private static final class Ticket {
        final String trackId;
        final String kind;
        volatile String upstreamUrl;
        final long expiresAt;

        Ticket(String trackId, String kind, String upstreamUrl, long expiresAt) {
            this.trackId = trackId;
            this.kind = kind;
            this.upstreamUrl = upstreamUrl;
            this.expiresAt = expiresAt;
        }
    }
}
