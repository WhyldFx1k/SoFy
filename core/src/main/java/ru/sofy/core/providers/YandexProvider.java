package ru.sofy.core.providers;

import com.fasterxml.jackson.databind.JsonNode;
import org.w3c.dom.Document;
import ru.sofy.core.Json;
import ru.sofy.core.Track;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class YandexProvider implements MusicProvider {
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(8))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();
    private static final String UA = "SoFy/0.1 (local desktop player)";
    private static final String API = "https://api.music.yandex.net";

    private volatile String token;

    public void setCredential(String credential) {
        String value = credential == null ? null : credential.trim();
        this.token = value == null || value.isBlank() ? null : value;
    }

    @Override
    public String id() {
        return "yandex";
    }

    @Override
    public String label() {
        return "Яндекс Музыка";
    }

    @Override
    public boolean isConfigured() {
        return token != null;
    }

    @Override
    public List<Track> search(String query, int limit, int offset) throws ProviderException {
        if (!isConfigured()) {
            throw new ProviderException("Подключите Яндекс Музыку в настройках");
        }
        int safeLimit = Math.max(1, Math.min(limit, 50));
        int page = Math.max(0, offset) / safeLimit;
        String url = API + "/search?text=" + encode(query) + "&type=track&page=" + page + "&nocorrect=false";
        JsonNode root = fetchJson(url);
        JsonNode results = root.path("result").path("tracks").path("results");
        List<Track> tracks = new ArrayList<>();
        if (!results.isArray()) return tracks;
        for (JsonNode item : results) {
            if (tracks.size() >= safeLimit) break;
            Track track = mapTrack(item);
            if (track != null) tracks.add(track);
        }
        return tracks;
    }

    private Track mapTrack(JsonNode node) {
        String externalId = node.path("id").asText("");
        if (!externalId.matches("\\d{1,25}(:\\d{1,25})?")) return null;
        String title = node.path("title").asText("Без названия");
        StringBuilder artists = new StringBuilder();
        for (JsonNode artist : node.path("artists")) {
            if (artists.length() > 0) artists.append(", ");
            artists.append(artist.path("name").asText(""));
        }
        JsonNode albums = node.path("albums");
        String album = null;
        String coverUri = null;
        if (albums.isArray() && !albums.isEmpty()) {
            album = albums.get(0).path("title").asText(null);
            coverUri = albums.get(0).path("coverUri").asText(null);
        }
        if (coverUri == null) coverUri = node.path("coverUri").asText(null);
        String artwork = null;
        if (coverUri != null && !coverUri.isBlank()) {
            artwork = coverUri.startsWith("https://") ? coverUri : "https://" + coverUri;
            artwork = artwork.replace("%%", "500x500");
        }
        long duration = node.path("durationMs").asLong(0);
        boolean available = node.path("available").asBoolean(true);
        String artistName = artists.length() == 0 ? "Яндекс Музыка" : artists.toString();
        return new Track("yandex:" + externalId, "yandex", externalId, title, artistName,
                album, duration, artwork, null, false, available);
    }

    @Override
    public Prepared prepare(Track track) throws ProviderException {
        if (!isConfigured()) {
            throw new ProviderException("Подключите Яндекс Музыку в настройках");
        }
        if (!track.externalId().matches("\\d{1,25}(:\\d{1,25})?")) {
            throw new ProviderException("Некорректный идентификатор трека Яндекс Музыки");
        }

        JsonNode info = fetchJson(API + "/tracks/" + track.externalId() + "/download-info");
        JsonNode variants = info.path("result");
        if (!variants.isArray() || variants.isEmpty()) {
            throw new ProviderException("Яндекс Музыка не отдала поток. Возможно, нужна подписка Plus.");
        }
        String downloadInfoUrl = null;
        long bestBitrate = -1;
        for (JsonNode variant : variants) {
            String codec = variant.path("codec").asText("");
            long bitrate = variant.path("bitrate").asLong(0);
            String url = variant.path("downloadInfoUrl").asText(null);
            if ("mp3".equalsIgnoreCase(codec) && url != null && bitrate > bestBitrate) {
                bestBitrate = bitrate;
                downloadInfoUrl = url;
            }
        }
        if (downloadInfoUrl == null) {
            throw new ProviderException("Яндекс Музыка не предложила mp3-поток для этого трека.");
        }
        String streamUrl = buildStreamUrl(downloadInfoUrl);
        if (streamUrl == null) {
            throw new ProviderException("Не удалось собрать ссылку на поток Яндекс Музыки.");
        }
        return new Prepared("progressive", streamUrl);
    }

    @Override
    public Upstream open(Track track, Prepared prepared, String rangeHeader) throws ProviderException {
        if (!"progressive".equals(prepared.kind())) {
            throw new ProviderException("Некорректный тип потока Яндекс Музыки");
        }
        Upstream upstream = requestStream(prepared.url(), rangeHeader);
        if (upstream.status() == 401 || upstream.status() == 403 || upstream.status() == 410) {
            upstream.close();
            Prepared fresh = prepare(track);
            upstream = requestStream(fresh.url(), rangeHeader);
        }
        if (upstream.status() >= 400) {
            int status = upstream.status();
            upstream.close();
            if (status == 401 || status == 403 || status == 451) {
                throw new ProviderException("Яндекс Музыка: трек недоступен без подписки Plus.");
            }
            throw new ProviderException("Яндекс Музыка вернула ошибку " + status);
        }
        return upstream;
    }

    private Upstream requestStream(String url, String rangeHeader) throws ProviderException {
        try {
            HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(25))
                    .header("User-Agent", UA)
                    .header("Accept", "*/*")
                    .header("Referer", "https://music.yandex.ru/")
                    .GET();
            if (rangeHeader != null && !rangeHeader.isBlank()) {
                builder.header("Range", rangeHeader);
            }
            HttpResponse<InputStream> response = HTTP.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
            Map<String, String> headers = new LinkedHashMap<>();
            response.headers().firstValue("Content-Type").ifPresent(v -> headers.put("Content-Type", v));
            response.headers().firstValue("Content-Length").ifPresent(v -> headers.put("Content-Length", v));
            response.headers().firstValue("Content-Range").ifPresent(v -> headers.put("Content-Range", v));
            response.headers().firstValue("Accept-Ranges").ifPresent(v -> headers.put("Accept-Ranges", v));
            if (!headers.containsKey("Content-Type")) headers.put("Content-Type", "audio/mpeg");
            return new Upstream(response.statusCode(), headers, response.body());
        } catch (Exception e) {
            throw new ProviderException("Не удалось получить поток Яндекс Музыки", e);
        }
    }

    private JsonNode fetchJson(String url) throws ProviderException {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(15))
                    .header("User-Agent", UA)
                    .header("Accept", "application/json")
                    .header("Authorization", "OAuth " + token)
                    .GET()
                    .build();
            HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 401) {
                throw new ProviderException("Токен Яндекс Музыки недействителен или истёк.");
            }
            if (response.statusCode() == 403) {
                throw new ProviderException("Яндекс Музыка отклонила токен (403).");
            }
            if (response.statusCode() != 200) {
                throw new ProviderException("Яндекс Музыка вернула ошибку " + response.statusCode());
            }
            return Json.MAPPER.readTree(response.body());
        } catch (ProviderException e) {
            throw e;
        } catch (Exception e) {
            throw new ProviderException("Яндекс Музыка недоступна. Проверьте соединение.", e);
        }
    }

    private String buildStreamUrl(String downloadInfoUrl) throws ProviderException {
        if (!downloadInfoUrl.startsWith("https://")) return null;
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(downloadInfoUrl))
                    .timeout(Duration.ofSeconds(15))
                    .header("User-Agent", UA)
                    .GET()
                    .build();
            HttpResponse<InputStream> response = HTTP.send(request, HttpResponse.BodyHandlers.ofInputStream());
            if (response.statusCode() != 200) {
                response.body().close();
                return null;
            }
            try (InputStream body = response.body()) {
                DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
                factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
                factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
                factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
                factory.setXIncludeAware(false);
                factory.setExpandEntityReferences(false);
                Document document = factory.newDocumentBuilder().parse(body);
                String host = text(document, "host");
                String path = text(document, "path");
                String ts = text(document, "ts");
                String sign = text(document, "s");
                if (host == null || path == null || ts == null || sign == null) return null;
                if (!host.matches("[a-zA-Z0-9.-]{1,253}") || !path.startsWith("/")
                        || !ts.matches("\\d{1,20}") || !sign.matches("[a-zA-Z0-9_-]{1,64}")) {
                    return null;
                }
                return "https://" + host + "/get-mp3/" + sign + "/" + ts + path;
            }
        } catch (Exception e) {
            return null;
        }
    }

    private static String text(Document document, String tag) {
        var nodes = document.getElementsByTagName(tag);
        if (nodes.getLength() == 0) return null;
        String value = nodes.item(0).getTextContent();
        return value == null ? null : value.trim();
    }

    private static String encode(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
