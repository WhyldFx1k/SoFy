package ru.sofy.core.providers;

import ru.sofy.core.Track;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;

public interface MusicProvider {
    String id();

    String label();

    boolean isConfigured();

    List<Track> search(String query, int limit, int offset) throws ProviderException;

    /**
     * Resolves a playable upstream: "progressive" (byte stream), "hls" (playlist)
     * or "file" (local demo audio).
     */
    Prepared prepare(Track track) throws ProviderException;

    Upstream open(Track track, Prepared prepared, String rangeHeader) throws ProviderException;

    record Prepared(String kind, String url) {
    }

    record Upstream(int status, Map<String, String> headers, InputStream body) implements Closeable {
        @Override
        public void close() {
            try {
                body.close();
            } catch (IOException ignored) {
                // client went away
            }
        }
    }
}
