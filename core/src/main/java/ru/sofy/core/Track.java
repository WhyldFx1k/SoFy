package ru.sofy.core;

public record Track(
        String id,
        String provider,
        String externalId,
        String title,
        String artist,
        String album,
        long durationMs,
        String artworkUrl,
        String color,
        boolean preview,
        boolean streamable
) {
}
