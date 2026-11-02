package ru.sofy.core;

import org.jaudiotagger.audio.AudioFile;
import org.jaudiotagger.audio.AudioFileIO;
import org.jaudiotagger.tag.FieldKey;
import org.jaudiotagger.tag.Tag;
import org.jaudiotagger.tag.images.Artwork;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Base64;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Copies user files into the managed music folder and derives playable track
 * metadata. Filenames in that folder are generated, so nothing outside it is
 * ever exposed to the streaming layer.
 */
public final class LocalLibrary {
    private static final Logger TAG_LOG = Logger.getLogger("org.jaudiotagger");
    static {
        TAG_LOG.setLevel(Level.OFF);
        TAG_LOG.setUseParentHandlers(false);
    }

    public static final Set<String> EXTENSIONS = Set.of(
            "mp3", "m4a", "aac", "flac", "ogg", "opus", "wav", "webm");
    private static final long MAX_BYTES = 300L * 1024 * 1024;
    private static final int MAX_ARTWORK_BYTES = 512 * 1024;

    private final Path musicDir;

    public LocalLibrary(Path dataDir) throws IOException {
        this.musicDir = dataDir.resolve("music").toAbsolutePath().normalize();
        Files.createDirectories(musicDir);
    }

    public Path musicDir() {
        return musicDir;
    }

    public Track importFile(String sourcePath) {
        if (sourcePath == null || sourcePath.isBlank() || sourcePath.length() > 4096) {
            throw new ApiException(400, "Некорректный путь к файлу");
        }
        Path source;
        try {
            source = Path.of(sourcePath).toAbsolutePath().normalize();
        } catch (RuntimeException e) {
            throw new ApiException(400, "Некорректный путь к файлу");
        }
        if (!source.isAbsolute() || !Files.isRegularFile(source)) {
            throw new ApiException(400, "Файл не найден");
        }

        String original = source.getFileName().toString();
        String extension = extensionOf(original);
        if (!EXTENSIONS.contains(extension)) {
            throw new ApiException(415, "Поддерживаются MP3, M4A, AAC, FLAC, OGG, OPUS, WAV и WEBM");
        }
        try {
            if (Files.size(source) > MAX_BYTES) {
                throw new ApiException(413, "Файл больше 300 МБ");
            }
        } catch (IOException e) {
            throw new ApiException(400, "Не удалось прочитать файл");
        }

        String storedName = UUID.randomUUID().toString().replace("-", "") + "." + extension;
        Path target = musicDir.resolve(storedName);
        try {
            Files.copy(source, target, StandardCopyOption.COPY_ATTRIBUTES);
        } catch (IOException e) {
            throw new ApiException(500, "Не удалось скопировать файл в библиотеку");
        }

        try {
            return readTrack(target, storedName, original, extension);
        } catch (RuntimeException e) {
            deleteQuietly(target);
            throw e;
        }
    }

    private Track readTrack(Path file, String storedName, String original, String extension) {
        String title = null;
        String artist = null;
        String album = null;
        long durationMs = 0;
        String artwork = null;

        try {
            AudioFile audio = AudioFileIO.read(file.toFile());
            if (audio.getAudioHeader() != null) {
                durationMs = Math.max(0, audio.getAudioHeader().getTrackLength()) * 1000L;
            }
            Tag tag = audio.getTag();
            if (tag != null) {
                title = clean(tag.getFirst(FieldKey.TITLE));
                artist = clean(tag.getFirst(FieldKey.ARTIST));
                album = clean(tag.getFirst(FieldKey.ALBUM));
                artwork = artworkDataUrl(tag.getFirstArtwork());
            }
        } catch (Exception e) {
            // Unreadable tags must not block playback — fall back to filename.
        }

        String base = original.substring(0, original.length() - extension.length() - 1);
        if (title == null) {
            String[] parts = base.split("\\s+[-–—]\\s+", 2);
            if (parts.length == 2 && !parts[1].isBlank()) {
                if (artist == null) artist = clean(parts[0]);
                title = clean(parts[1]);
            } else {
                title = clean(base.replace('_', ' '));
            }
        }
        if (title == null) title = "Без названия";
        if (artist == null) artist = "Неизвестный исполнитель";
        if (durationMs < 0) durationMs = 0;

        return new Track("local:" + storedName, "local", storedName, title, artist, album,
                durationMs, artwork, null, false, true);
    }

    private static String artworkDataUrl(Artwork artwork) {
        if (artwork == null) return null;
        try {
            byte[] data = artwork.getBinaryData();
            if (data == null || data.length == 0 || data.length > MAX_ARTWORK_BYTES) return null;
            String mime = artwork.getMimeType();
            if (mime == null) return null;
            mime = mime.toLowerCase(Locale.ROOT);
            if (!mime.startsWith("image/")) return null;
            return "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(data);
        } catch (Exception e) {
            return null;
        }
    }

    private static String clean(String value) {
        if (value == null) return null;
        String trimmed = value.replaceAll("\\p{Cntrl}", " ").trim();
        if (trimmed.isEmpty()) return null;
        return trimmed.length() > 300 ? trimmed.substring(0, 300) : trimmed;
    }

    private static String extensionOf(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 1 || dot == name.length() - 1) return "";
        return name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    private static void deleteQuietly(Path file) {
        try {
            Files.deleteIfExists(file);
        } catch (IOException ignored) {
            // leave the orphan for the next import attempt
        }
    }
}
