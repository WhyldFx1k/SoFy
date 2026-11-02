package ru.sofy.core.providers;

import ru.sofy.core.Track;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * Tracks imported from the user's disk. Bytes are served by StreamService from
 * the managed music folder, so prepare() only resolves and validates the path.
 */
public final class LocalProvider implements MusicProvider {
    private final Path musicDir;

    public LocalProvider(Path musicDir) {
        this.musicDir = musicDir.toAbsolutePath().normalize();
    }

    @Override
    public String id() {
        return "local";
    }

    @Override
    public String label() {
        return "Мои треки";
    }

    @Override
    public boolean isConfigured() {
        return true;
    }

    @Override
    public List<Track> search(String query, int limit, int offset) {
        return List.of();
    }

    @Override
    public Prepared prepare(Track track) throws ProviderException {
        Path file = resolve(track.externalId());
        if (file == null) throw new ProviderException("Некорректное имя локального файла");
        if (!Files.isRegularFile(file)) {
            throw new ProviderException("Файл не найден — добавьте его заново");
        }
        return new Prepared("file", file.toString());
    }

    @Override
    public Upstream open(Track track, Prepared prepared, String rangeHeader) throws ProviderException {
        throw new ProviderException("Локальный файл отдаётся напрямую");
    }

    public Path resolve(String name) {
        if (name == null || !name.matches("[A-Za-z0-9._-]{1,140}")) return null;
        Path candidate = musicDir.resolve(name).normalize();
        return candidate.startsWith(musicDir) ? candidate : null;
    }
}
