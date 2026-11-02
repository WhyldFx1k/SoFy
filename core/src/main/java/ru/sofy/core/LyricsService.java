package ru.sofy.core;

import com.fasterxml.jackson.databind.JsonNode;

import org.jaudiotagger.audio.AudioFile;
import org.jaudiotagger.audio.AudioFileIO;
import org.jaudiotagger.tag.FieldKey;
import org.jaudiotagger.tag.Tag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.logging.Level;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Resolves track lyrics: embedded tags for local files first, then a public
 * lyrics catalogue. Results are cached in SQLite so repeated openings are
 * instant and offline.
 */
public final class LyricsService {
    private static final Logger log = LoggerFactory.getLogger(LyricsService.class);
    private static final java.util.logging.Logger TAG_LOG =
            java.util.logging.Logger.getLogger("org.jaudiotagger");
    static {
        TAG_LOG.setLevel(Level.OFF);
    }

    private static final String SEARCH_URL = "https://lrclib.net/api/search?";
    private static final String UA = "SoFy Player 0.0.5 (desktop; local music player)";
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(6))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();
    private static final int MAX_RESPONSE_BYTES = 1024 * 1024;
    private static final int MAX_PLAIN_CHARS = 20_000;
    private static final int MAX_SYNCED_CHARS = 60_000;
    private static final int MAX_LINES = 2_000;
    private static final int MAX_LINE_CHARS = 300;
    private static final long NOT_FOUND_RETRY_MS = 6 * 60 * 60 * 1000L;
    private static final Pattern LRC_TAG = Pattern.compile("\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?]");
    private static final Pattern BRACKETED = Pattern.compile(
            "(?i)\\s*[\\[(][^\\])]*(official|video|audio|lyrics?|remix|live|version|версия|prod|cover|clip)[^\\])]*[\\])]");
    private static final Pattern FEATURING = Pattern.compile("(?i)\\s+(feat\\.?|ft\\.?)\\s+.*$");
    private static final Pattern ARTIST_SUFFIX = Pattern.compile("(?i)\\s*[-–—]\\s*topic$");
    private static final Pattern CONTROL = Pattern.compile("[\\p{Cntrl}&&[^\\n\\t]]");

    private final Db db;
    private final Path musicDir;

    public LyricsService(Db db, Path musicDir) {
        this.db = db;
        this.musicDir = musicDir.toAbsolutePath().normalize();
    }

    public Map<String, Object> fetch(String trackId) {
        Track track = db.getTrack(trackId)
                .orElseThrow(() -> new ApiException(404, "Трек не найден"));
        long now = System.currentTimeMillis();
        Optional<Db.LyricsRecord> cached = db.lyrics(trackId);
        if (cached.isPresent()) {
            Db.LyricsRecord record = cached.get();
            if (record.found() || now - record.fetchedAt() < NOT_FOUND_RETRY_MS) {
                return payload(record);
            }
        }

        Db.LyricsRecord record = null;
        if (track.provider().equals("local")) {
            record = fromFile(track, now);
        }
        if (record == null) {
            record = fromCatalogue(track, now);
        }
        db.saveLyrics(trackId, record);
        return payload(record);
    }

    private Db.LyricsRecord fromFile(Track track, long now) {
        Path file = musicDir.resolve(track.externalId()).normalize();
        if (!file.startsWith(musicDir) || !Files.isRegularFile(file)) return null;
        try {
            AudioFile audio = AudioFileIO.read(file.toFile());
            Tag tag = audio.getTag();
            if (tag == null) return null;
            String lyrics = tag.getFirst(FieldKey.LYRICS);
            if (lyrics == null || lyrics.isBlank()) return null;
            String clean = sanitize(lyrics, MAX_SYNCED_CHARS);
            if (clean == null) return null;
            if (LRC_TAG.matcher(clean).find()) {
                List<Map<String, Object>> lines = parseSynced(clean);
                if (lines.isEmpty()) return null;
                String plain = joinLines(lines);
                return new Db.LyricsRecord(plain, clean, false, true, now);
            }
            return new Db.LyricsRecord(sanitize(clean, MAX_PLAIN_CHARS), null, false, true, now);
        } catch (Exception e) {
            log.debug("embedded lyrics unavailable: {}", track.id());
            return null;
        }
    }

    private Db.LyricsRecord fromCatalogue(Track track, long now) {
        String title = track.title();
        String artist = track.artist();
        JsonNode match = search(title, artist, track.durationMs());
        if (match == null) {
            String cleanTitle = cleanTitle(title);
            String cleanArtist = ARTIST_SUFFIX.matcher(artist).replaceAll("");
            if (!cleanTitle.equalsIgnoreCase(title) || !cleanArtist.equalsIgnoreCase(artist)) {
                match = search(cleanTitle, cleanArtist, track.durationMs());
            }
        }
        if (match == null) return new Db.LyricsRecord(null, null, false, false, now);

        String synced = sanitize(Json.text(match, "syncedLyrics"), MAX_SYNCED_CHARS);
        String plain = sanitize(Json.text(match, "plainLyrics"), MAX_PLAIN_CHARS);
        boolean instrumental = match.path("instrumental").asBoolean(false);
        if (synced != null && !LRC_TAG.matcher(synced).find()) {
            if (plain == null) plain = sanitize(synced, MAX_PLAIN_CHARS);
            synced = null;
        }
        boolean found = synced != null || plain != null || instrumental;
        return new Db.LyricsRecord(plain, synced, instrumental && plain == null && synced == null, found, now);
    }

    private JsonNode search(String trackName, String artistName, long durationMs) {
        if (trackName == null || trackName.isBlank()) return null;
        String url = SEARCH_URL
                + "track_name=" + encode(trackName)
                + (artistName == null || artistName.isBlank() ? "" : "&artist_name=" + encode(artistName));
        JsonNode items;
        try {
            items = Json.parse(httpGet(url));
        } catch (IllegalArgumentException e) {
            return null;
        }
        if (!items.isArray() || items.isEmpty()) return null;

        JsonNode best = null;
        int bestScore = -1;
        long bestDelta = Long.MAX_VALUE;
        for (JsonNode item : items) {
            if (!item.isObject()) continue;
            String synced = Json.text(item, "syncedLyrics");
            String plain = Json.text(item, "plainLyrics");
            boolean instrumental = item.path("instrumental").asBoolean(false);
            int score = 0;
            if (synced != null && !synced.isBlank()) score += synced.contains("[") ? 3 : 1;
            if (plain != null && !plain.isBlank()) score += 1;
            if (instrumental) score += 1;
            long duration = item.path("duration").asLong(0);
            long delta = duration > 0 && duration < 3600 * 24 && durationMs > 0
                    ? Math.abs(duration * 1000 - durationMs)
                    : Long.MAX_VALUE / 2;
            if (delta <= 4000) score += 2;
            if (score > bestScore || (score == bestScore && delta < bestDelta)) {
                best = item;
                bestScore = score;
                bestDelta = delta;
            }
        }
        return best;
    }

    private String httpGet(String url) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(8))
                .header("User-Agent", UA)
                .header("Accept", "application/json")
                .GET()
                .build();
        try {
            HttpResponse<InputStream> response = HTTP.send(request, HttpResponse.BodyHandlers.ofInputStream());
            int status = response.statusCode();
            try (InputStream body = response.body()) {
                if (status == 404) return "[]";
                if (status != 200) throw new ApiException(503, "Сервис текстов недоступен");
                byte[] data = body.readNBytes(MAX_RESPONSE_BYTES + 1);
                if (data.length > MAX_RESPONSE_BYTES) return "[]";
                return new String(data, StandardCharsets.UTF_8);
            }
        } catch (ApiException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(503, "Сервис текстов недоступен");
        } catch (Exception e) {
            throw new ApiException(503, "Сервис текстов недоступен");
        }
    }

    private static Map<String, Object> payload(Db.LyricsRecord record) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("found", record.found());
        result.put("instrumental", record.instrumental());
        result.put("plain", record.plain());
        result.put("synced", parseSynced(record.synced()));
        return result;
    }

    static List<Map<String, Object>> parseSynced(String raw) {
        List<Map<String, Object>> lines = new ArrayList<>();
        if (raw == null || raw.isBlank()) return lines;
        for (String line : raw.split("\\n")) {
            Matcher matcher = LRC_TAG.matcher(line);
            List<Long> stamps = new ArrayList<>();
            int end = 0;
            while (matcher.find() && matcher.start() == end) {
                long minutes = Long.parseLong(matcher.group(1));
                long seconds = Long.parseLong(matcher.group(2));
                String fraction = matcher.group(3);
                long millis = 0;
                if (fraction != null) {
                    millis = switch (fraction.length()) {
                        case 1 -> Long.parseLong(fraction) * 100;
                        case 2 -> Long.parseLong(fraction) * 10;
                        default -> Long.parseLong(fraction.substring(0, 3));
                    };
                }
                stamps.add(minutes * 60_000L + seconds * 1000L + millis);
                end = matcher.end();
            }
            if (stamps.isEmpty()) continue;
            String text = sanitizeLine(line.substring(end));
            for (long stamp : stamps) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("timeMs", stamp);
                item.put("text", text);
                lines.add(item);
                if (lines.size() >= MAX_LINES) break;
            }
            if (lines.size() >= MAX_LINES) break;
        }
        lines.sort(Comparator.comparingLong(item -> (long) item.get("timeMs")));
        return lines;
    }

    private static String joinLines(List<Map<String, Object>> lines) {
        StringBuilder builder = new StringBuilder();
        for (Map<String, Object> line : lines) {
            String text = (String) line.get("text");
            if (text.isEmpty()) continue;
            if (!builder.isEmpty()) builder.append('\n');
            builder.append(text);
            if (builder.length() > MAX_PLAIN_CHARS) break;
        }
        String result = builder.toString();
        return result.length() > MAX_PLAIN_CHARS ? result.substring(0, MAX_PLAIN_CHARS) : result;
    }

    private static String sanitizeLine(String value) {
        String clean = CONTROL.matcher(value).replaceAll(" ").trim();
        if (clean.length() > MAX_LINE_CHARS) clean = clean.substring(0, MAX_LINE_CHARS);
        return clean;
    }

    private static String sanitize(String value, int max) {
        if (value == null) return null;
        String clean = CONTROL.matcher(value.replace("\r\n", "\n").replace('\r', '\n')).replaceAll("").trim();
        if (clean.isEmpty()) return null;
        if (clean.length() > max) clean = clean.substring(0, max);
        return clean;
    }

    private static String cleanTitle(String title) {
        if (title == null) return "";
        String clean = BRACKETED.matcher(title).replaceAll(" ");
        clean = FEATURING.matcher(clean).replaceAll(" ");
        clean = clean.replaceAll("\\s{2,}", " ").trim();
        return clean.isEmpty() ? title : clean;
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
