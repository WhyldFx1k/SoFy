package ru.sofy.core;

import ru.sofy.core.providers.LocalProvider;
import ru.sofy.core.providers.Providers;
import ru.sofy.core.providers.SoundCloudProvider;
import ru.sofy.core.providers.YandexProvider;

import java.nio.file.Files;
import java.nio.file.Path;

public final class SoFyCore {
    private SoFyCore() {
    }

    public static void main(String[] args) {
        System.setProperty("org.slf4j.simpleLogger.defaultLogLevel", "info");
        System.setProperty("org.slf4j.simpleLogger.showDateTime", "true");
        System.setProperty("org.slf4j.simpleLogger.dateTimeFormat", "HH:mm:ss");

        String token = System.getenv("SOFY_TOKEN");
        if (token == null || token.length() < 32) {
            System.err.println("SOFY_TOKEN is required (min 32 chars)");
            System.exit(2);
        }

        Path dataDir = Path.of(envOr("SOFY_DATA_DIR", Path.of(System.getProperty("user.home"), ".sofy").toString()));
        try {
            Files.createDirectories(dataDir);
            Db db = new Db(dataDir.resolve("sofy.db"));
            db.purgeProvider("demo");
            SoundCloudProvider soundcloud = new SoundCloudProvider(dataDir);
            String manualClientId = System.getenv("SOFY_SOUNDCLOUD_CLIENT_ID");
            if (manualClientId != null && !manualClientId.isBlank()) soundcloud.setCredential(manualClientId);
            YandexProvider yandex = new YandexProvider();
            String yandexToken = System.getenv("SOFY_YANDEX_TOKEN");
            if (yandexToken != null && !yandexToken.isBlank()) yandex.setCredential(yandexToken);
            LocalLibrary localLibrary = new LocalLibrary(dataDir);
            Providers providers = new Providers(soundcloud, yandex, new LocalProvider(localLibrary.musicDir()));
            StreamService streams = new StreamService(db, providers, localLibrary.musicDir());
            LyricsService lyrics = new LyricsService(db, localLibrary.musicDir());
            Api api = new Api(token, db, providers, streams, localLibrary, lyrics);
            int port = api.start();
            System.out.println("SOFY_READY " + port);
            System.out.flush();
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                api.stop();
                db.close();
            }, "sofy-shutdown"));
        } catch (Exception e) {
            System.err.println("SoFy core failed to start: " + e.getMessage());
            e.printStackTrace(System.err);
            System.exit(1);
        }
    }

    private static String envOr(String key, String fallback) {
        String value = System.getenv(key);
        return value == null || value.isBlank() ? fallback : value;
    }
}
