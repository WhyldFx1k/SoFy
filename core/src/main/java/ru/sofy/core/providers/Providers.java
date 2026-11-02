package ru.sofy.core.providers;

import ru.sofy.core.Track;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public final class Providers {
    private final SoundCloudProvider soundcloud;
    private final YandexProvider yandex;
    private final Map<String, MusicProvider> byId = new LinkedHashMap<>();

    public Providers(SoundCloudProvider soundcloud, YandexProvider yandex, LocalProvider local) {
        this.soundcloud = soundcloud;
        this.yandex = yandex;
        byId.put(soundcloud.id(), soundcloud);
        byId.put(yandex.id(), yandex);
        byId.put(local.id(), local);
    }

    public MusicProvider get(String id) {
        return byId.get(id);
    }

    public boolean isKnown(String id) {
        return byId.containsKey(id);
    }

    public List<Map<String, Object>> status() {
        List<Map<String, Object>> result = new ArrayList<>();
        result.add(statusOf(soundcloud, true, false,
                "Ключ подбирается автоматически. Можно указать свой client_id.",
                soundcloud.hasManualCredential() ? "manual" : "auto"));
        result.add(statusOf(yandex, true, true,
                "OAuth-токен вашего аккаунта Яндекс Музыки",
                yandex.isConfigured() ? "manual" : "none"));
        return result;
    }

    private static Map<String, Object> statusOf(MusicProvider provider, boolean optionalCredential,
                                                boolean requiresCredential, String hint, String mode) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", provider.id());
        map.put("label", provider.label());
        map.put("connected", provider.isConfigured());
        map.put("optionalCredential", optionalCredential);
        map.put("requiresCredential", requiresCredential);
        map.put("credentialHint", hint);
        map.put("mode", mode);
        return map;
    }

    public void setCredential(String providerId, String credential) throws ProviderException {
        MusicProvider provider = byId.get(providerId);
        if (provider == null) throw new ProviderException("Неизвестный источник");
        String value = credential == null ? "" : credential.trim();
        if (providerId.equals("soundcloud")) {
            if (!value.matches("[A-Za-z0-9._-]{8,200}")) {
                throw new ProviderException("client_id SoundCloud выглядит некорректно");
            }
            soundcloud.setCredential(value);
        } else if (providerId.equals("yandex")) {
            if (!value.matches("\\S{20,4096}")) {
                throw new ProviderException("Токен Яндекс Музыки выглядит некорректно");
            }
            yandex.setCredential(value);
        } else {
            throw new ProviderException("Неизвестный источник");
        }
    }

    public void clearCredential(String providerId) {
        if (providerId.equals("soundcloud")) soundcloud.setCredential(null);
        if (providerId.equals("yandex")) yandex.setCredential(null);
    }

    public SearchOutcome search(String query, String target, int limit, int offset) {
        List<Track> tracks = new ArrayList<>();
        List<Map<String, String>> errors = Collections.synchronizedList(new ArrayList<>());
        boolean all = target == null || target.isBlank() || target.equals("all");
        if (!all && !target.equals("soundcloud") && !target.equals("yandex")) {
            throw new IllegalArgumentException("Неизвестный источник");
        }

        if (all) {
            // Providers are independent networks: query them concurrently, keep result order stable.
            try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
                Future<List<Track>> soundcloudTask = pool.submit(
                        () -> collectList(soundcloud, query, limit, offset, true, errors));
                Future<List<Track>> yandexTask = pool.submit(
                        () -> collectList(yandex, query, limit, offset, true, errors));
                tracks.addAll(await(soundcloudTask));
                tracks.addAll(await(yandexTask));
            }
        } else {
            MusicProvider provider = target.equals("yandex") ? yandex : soundcloud;
            tracks.addAll(collectList(provider, query, limit, offset, false, errors));
        }

        Set<String> seen = new LinkedHashSet<>();
        List<Track> unique = new ArrayList<>();
        for (Track track : tracks) {
            if (seen.add(track.id())) unique.add(track);
        }
        return new SearchOutcome(unique, errors);
    }

    private static List<Track> collectList(MusicProvider provider, String query, int limit, int offset,
                                           boolean aggregate, List<Map<String, String>> errors) {
        List<Track> tracks = new ArrayList<>();
        collect(provider, query, limit, offset, aggregate, tracks, errors);
        return tracks;
    }

    private static List<Track> await(Future<List<Track>> future) {
        try {
            return future.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return List.of();
        } catch (ExecutionException e) {
            return List.of();
        }
    }

    private static void collect(MusicProvider provider, String query, int limit, int offset, boolean aggregate,
                                List<Track> tracks, List<Map<String, String>> errors) {
        if (!provider.isConfigured()) {
            if (!aggregate) {
                Map<String, String> error = new LinkedHashMap<>();
                error.put("provider", provider.id());
                error.put("label", provider.label());
                error.put("message", "Источник не подключён");
                errors.add(error);
            }
            return;
        }
        try {
            tracks.addAll(provider.search(query, limit, offset));
        } catch (ProviderException e) {
            Map<String, String> error = new LinkedHashMap<>();
            error.put("provider", provider.id());
            error.put("label", provider.label());
            error.put("message", e.getMessage());
            errors.add(error);
        } catch (Exception e) {
            Map<String, String> error = new LinkedHashMap<>();
            error.put("provider", provider.id());
            error.put("label", provider.label());
            error.put("message", "Не удалось выполнить поиск");
            errors.add(error);
        }
    }

    public record SearchOutcome(List<Track> tracks, List<Map<String, String>> errors) {
    }
}
