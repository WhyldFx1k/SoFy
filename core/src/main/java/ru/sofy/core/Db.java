package ru.sofy.core;

import org.sqlite.SQLiteConfig;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Single-connection SQLite store. All access is serialized: the workload is a
 * local desktop UI, not a server.
 */
public final class Db implements AutoCloseable {
    public static final Map<String, String> DEFAULT_SETTINGS = Map.of(
            "volume", "0.8",
            "quality", "high",
            "shuffle", "false",
            "repeat", "off",
            "reduceMotion", "false",
            "genre", "pop",
            "theme", "aurora",
            "windowButtons", "right"
    );

    private final Connection connection;
    private final Map<String, String> trackCovers = new LinkedHashMap<>();
    private int historyInserts;

    public Db(Path file) throws SQLException, IOException {
        Files.createDirectories(file.getParent());
        SQLiteConfig config = new SQLiteConfig();
        config.enforceForeignKeys(true);
        config.setJournalMode(SQLiteConfig.JournalMode.WAL);
        config.setBusyTimeout(5000);
        config.setSynchronous(SQLiteConfig.SynchronousMode.NORMAL);
        this.connection = DriverManager.getConnection("jdbc:sqlite:" + file.toAbsolutePath(), config.toProperties());
        migrate();
        loadTrackCovers();
        seedSettings();
        trimHistory();
    }

    private void migrate() throws SQLException {
        try (Statement st = connection.createStatement()) {
            st.execute("""
                    CREATE TABLE IF NOT EXISTS meta (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    )
                    """);
            st.execute("""
                    CREATE TABLE IF NOT EXISTS tracks (
                        id TEXT PRIMARY KEY,
                        provider TEXT NOT NULL,
                        external_id TEXT NOT NULL,
                        title TEXT NOT NULL,
                        artist TEXT NOT NULL,
                        album TEXT,
                        duration_ms INTEGER NOT NULL DEFAULT 0,
                        artwork_url TEXT,
                        color TEXT,
                        preview INTEGER NOT NULL DEFAULT 0,
                        streamable INTEGER NOT NULL DEFAULT 1,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL,
                        UNIQUE(provider, external_id)
                    )
                    """);
            st.execute("""
                    CREATE TABLE IF NOT EXISTS likes (
                        track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
                        liked_at INTEGER NOT NULL
                    )
                    """);
            st.execute("""
                    CREATE TABLE IF NOT EXISTS history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                        played_at INTEGER NOT NULL
                    )
                    """);
            st.execute("CREATE INDEX IF NOT EXISTS idx_history_played ON history(played_at DESC)");
            st.execute("""
                    CREATE TABLE IF NOT EXISTS playlists (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        cover TEXT,
                        description TEXT,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                    )
                    """);
            st.execute("""
                    CREATE TABLE IF NOT EXISTS track_covers (
                        track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
                        cover TEXT NOT NULL,
                        updated_at INTEGER NOT NULL
                    )
                    """);
            st.execute("""
                    CREATE TABLE IF NOT EXISTS playlist_tracks (
                        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                        position INTEGER NOT NULL,
                        added_at INTEGER NOT NULL,
                        PRIMARY KEY(playlist_id, track_id)
                    )
                    """);
            st.execute("""
                    CREATE TABLE IF NOT EXISTS settings (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    )
                    """);
            st.execute("""
                    CREATE TABLE IF NOT EXISTS accounts (
                        id TEXT PRIMARY KEY,
                        username TEXT NOT NULL UNIQUE,
                        display_name TEXT NOT NULL,
                        avatar TEXT,
                        role TEXT NOT NULL DEFAULT 'user',
                        password_hash TEXT NOT NULL,
                        password_salt TEXT NOT NULL,
                        iterations INTEGER NOT NULL,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                    )
                    """);
            st.execute("""
                    CREATE TABLE IF NOT EXISTS sessions (
                        token_hash TEXT PRIMARY KEY,
                        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                        created_at INTEGER NOT NULL,
                        expires_at INTEGER NOT NULL
                    )
                    """);
            st.execute("CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id)");
            st.execute("""
                    CREATE TABLE IF NOT EXISTS access_keys (
                        id TEXT PRIMARY KEY,
                        code_hash TEXT NOT NULL UNIQUE,
                        role TEXT NOT NULL,
                        note TEXT,
                        hint TEXT NOT NULL,
                        created_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
                        redeemed_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
                        created_at INTEGER NOT NULL,
                        redeemed_at INTEGER,
                        revoked INTEGER NOT NULL DEFAULT 0,
                        revoked_at INTEGER
                    )
                    """);
            st.execute("CREATE INDEX IF NOT EXISTS idx_access_keys_created ON access_keys(created_at DESC)");
            st.execute("""
                    CREATE TABLE IF NOT EXISTS lyrics (
                        track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
                        plain TEXT,
                        synced TEXT,
                        instrumental INTEGER NOT NULL DEFAULT 0,
                        found INTEGER NOT NULL DEFAULT 0,
                        fetched_at INTEGER NOT NULL
                    )
                    """);
            st.execute("INSERT OR IGNORE INTO meta(key, value) VALUES('schema', '1')");
            try {
                st.execute("ALTER TABLE tracks ADD COLUMN preview INTEGER NOT NULL DEFAULT 0");
            } catch (SQLException ignored) {
                // column already exists (fresh schema or previous migration)
            }
            try {
                st.execute("ALTER TABLE playlists ADD COLUMN cover TEXT");
            } catch (SQLException ignored) {
                // column already exists (fresh schema or previous migration)
            }
            try {
                st.execute("ALTER TABLE playlists ADD COLUMN description TEXT");
            } catch (SQLException ignored) {
                // column already exists (fresh schema or previous migration)
            }
            try {
                st.execute("ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
            } catch (SQLException ignored) {
                // column already exists (fresh schema or previous migration)
            }
        }
    }

    private void loadTrackCovers() throws SQLException {
        try (Statement st = connection.createStatement();
             ResultSet rs = st.executeQuery("SELECT track_id, cover FROM track_covers")) {
            while (rs.next()) {
                trackCovers.put(rs.getString("track_id"), rs.getString("cover"));
            }
        }
    }

    private void seedSettings() throws SQLException {
        try (PreparedStatement ps = connection.prepareStatement(
                "INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)")) {
            for (Map.Entry<String, String> entry : DEFAULT_SETTINGS.entrySet()) {
                ps.setString(1, entry.getKey());
                ps.setString(2, entry.getValue());
                ps.addBatch();
            }
            ps.executeBatch();
        }
    }

    public synchronized void upsertTrack(Track track) {
        long now = System.currentTimeMillis();
        try (PreparedStatement ps = connection.prepareStatement(UPSERT_TRACK_SQL)) {
            bindTrack(ps, track, now);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("Не удалось сохранить трек", e);
        }
    }

    public synchronized void upsertTracks(List<Track> tracks) {
        if (tracks.isEmpty()) return;
        long now = System.currentTimeMillis();
        try {
            connection.setAutoCommit(false);
            try (PreparedStatement ps = connection.prepareStatement(UPSERT_TRACK_SQL)) {
                for (Track track : tracks) {
                    bindTrack(ps, track, now);
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            connection.commit();
        } catch (SQLException e) {
            try {
                connection.rollback();
            } catch (SQLException ignored) {
                // connection is already broken
            }
            throw new IllegalStateException("Не удалось сохранить треки", e);
        } finally {
            try {
                connection.setAutoCommit(true);
            } catch (SQLException ignored) {
                // best effort
            }
        }
    }

    private static void bindTrack(PreparedStatement ps, Track track, long now) throws SQLException {
        int i = 1;
        ps.setString(i++, track.id());
        ps.setString(i++, track.provider());
        ps.setString(i++, track.externalId());
        ps.setString(i++, track.title());
        ps.setString(i++, track.artist());
        ps.setString(i++, track.album());
        ps.setLong(i++, track.durationMs());
        ps.setString(i++, track.artworkUrl());
        ps.setString(i++, track.color());
        ps.setInt(i++, track.preview() ? 1 : 0);
        ps.setInt(i++, track.streamable() ? 1 : 0);
        ps.setLong(i++, now);
        ps.setLong(i, now);
    }

    private static final String UPSERT_TRACK_SQL = """
            INSERT INTO tracks(id, provider, external_id, title, artist, album, duration_ms,
                               artwork_url, color, preview, streamable, created_at, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                artist = excluded.artist,
                album = excluded.album,
                duration_ms = excluded.duration_ms,
                artwork_url = excluded.artwork_url,
                color = excluded.color,
                preview = excluded.preview,
                streamable = excluded.streamable,
                updated_at = excluded.updated_at
            """;

    public synchronized Optional<Track> getTrack(String id) {
        try (PreparedStatement ps = connection.prepareStatement("SELECT * FROM tracks WHERE id = ?")) {
            ps.setString(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(mapTrack(rs)) : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized List<Track> tracksByProvider(String provider, int limit) {
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT * FROM tracks WHERE provider = ? ORDER BY rowid ASC LIMIT ?")) {
            ps.setString(1, provider);
            ps.setInt(2, limit);
            return readTracks(ps);
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void purgeProvider(String provider) {
        try (PreparedStatement ps = connection.prepareStatement(
                "DELETE FROM tracks WHERE provider = ?")) {
            ps.setString(1, provider);
            ps.executeUpdate();
            trackCovers.keySet().removeIf(id -> id.startsWith(provider + ":"));
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void like(Track track) {
        upsertTrack(track);
        try (PreparedStatement ps = connection.prepareStatement(
                "INSERT OR REPLACE INTO likes(track_id, liked_at) VALUES(?, ?)")) {
            ps.setString(1, track.id());
            ps.setLong(2, System.currentTimeMillis());
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void unlike(String trackId) {
        try (PreparedStatement ps = connection.prepareStatement("DELETE FROM likes WHERE track_id = ?")) {
            ps.setString(1, trackId);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized List<Track> likes(int limit) {
        String sql = "SELECT t.* FROM likes l JOIN tracks t ON t.id = l.track_id " +
                "ORDER BY l.liked_at DESC LIMIT ?";
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setInt(1, limit);
            return readTracks(ps);
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void addHistory(Track track) {
        upsertTrack(track);
        try (PreparedStatement ps = connection.prepareStatement(
                "INSERT INTO history(track_id, played_at) VALUES(?, ?)")) {
            ps.setString(1, track.id());
            ps.setLong(2, System.currentTimeMillis());
            ps.executeUpdate();
            historyInserts++;
            if (historyInserts % 200 == 0) trimHistory();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized List<Track> history(int limit) {
        String sql = "SELECT t.*, MAX(h.played_at) AS last_played FROM history h " +
                "JOIN tracks t ON t.id = h.track_id GROUP BY t.id ORDER BY last_played DESC LIMIT ?";
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setInt(1, limit);
            return readTracks(ps);
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    private void trimHistory() {
        try (Statement st = connection.createStatement()) {
            st.executeUpdate("DELETE FROM history WHERE id NOT IN " +
                    "(SELECT id FROM history ORDER BY played_at DESC LIMIT 2000)");
        } catch (SQLException ignored) {
            // best effort housekeeping
        }
    }

    public synchronized Playlist createPlaylist(String name) {
        long now = System.currentTimeMillis();
        String id = java.util.UUID.randomUUID().toString();
        try (PreparedStatement ps = connection.prepareStatement(
                "INSERT INTO playlists(id, name, created_at, updated_at) VALUES(?, ?, ?, ?)")) {
            ps.setString(1, id);
            ps.setString(2, name);
            ps.setLong(3, now);
            ps.setLong(4, now);
            ps.executeUpdate();
            return new Playlist(id, name, null, null, now, now);
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void updatePlaylistMeta(String id, String cover, String description) {
        try (PreparedStatement ps = connection.prepareStatement(
                "UPDATE playlists SET cover = ?, description = ? WHERE id = ?")) {
            ps.setString(1, cover);
            ps.setString(2, description);
            ps.setString(3, id);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void setTrackCover(String trackId, String cover) {
        try {
            if (cover == null) {
                try (PreparedStatement ps = connection.prepareStatement(
                        "DELETE FROM track_covers WHERE track_id = ?")) {
                    ps.setString(1, trackId);
                    ps.executeUpdate();
                }
                trackCovers.remove(trackId);
            } else {
                try (PreparedStatement ps = connection.prepareStatement("""
                        INSERT INTO track_covers(track_id, cover, updated_at) VALUES(?, ?, ?)
                        ON CONFLICT(track_id) DO UPDATE SET
                            cover = excluded.cover,
                            updated_at = excluded.updated_at
                        """)) {
                    ps.setString(1, trackId);
                    ps.setString(2, cover);
                    ps.setLong(3, System.currentTimeMillis());
                    ps.executeUpdate();
                }
                trackCovers.put(trackId, cover);
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized List<Playlist> playlists() {
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT * FROM playlists ORDER BY updated_at DESC")) {
            try (ResultSet rs = ps.executeQuery()) {
                List<Playlist> result = new ArrayList<>();
                while (rs.next()) {
                    result.add(mapPlaylist(rs));
                }
                return result;
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized Optional<Playlist> playlist(String id) {
        try (PreparedStatement ps = connection.prepareStatement("SELECT * FROM playlists WHERE id = ?")) {
            ps.setString(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return Optional.empty();
                return Optional.of(mapPlaylist(rs));
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized Optional<Playlist> playlistByName(String name) {
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT * FROM playlists WHERE name = ? ORDER BY created_at ASC LIMIT 1")) {
            ps.setString(1, name);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return Optional.empty();
                return Optional.of(mapPlaylist(rs));
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Playlist mapPlaylist(ResultSet rs) throws SQLException {
        return new Playlist(
                rs.getString("id"),
                rs.getString("name"),
                rs.getString("cover"),
                rs.getString("description"),
                rs.getLong("created_at"),
                rs.getLong("updated_at"));
    }

    public synchronized Playlist ensurePlaylist(String name) {
        return playlistByName(name).orElseGet(() -> createPlaylist(name));
    }

    public synchronized Map<String, Integer> playlistTrackCounts() {
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT playlist_id, COUNT(*) AS total FROM playlist_tracks GROUP BY playlist_id");
             ResultSet rs = ps.executeQuery()) {
            Map<String, Integer> result = new LinkedHashMap<>();
            while (rs.next()) {
                result.put(rs.getString("playlist_id"), rs.getInt("total"));
            }
            return result;
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized Map<String, List<Track>> playlistPreviews(int perPlaylist) {
        int limit = Math.max(0, perPlaylist);
        Map<String, List<Track>> result = new LinkedHashMap<>();
        if (limit == 0) return result;
        String sql = """
                SELECT playlist_id, id, provider, external_id, title, artist, album, duration_ms,
                       artwork_url, color, preview, streamable
                FROM (
                    SELECT pt.playlist_id, t.id, t.provider, t.external_id, t.title, t.artist, t.album,
                           t.duration_ms, t.artwork_url, t.color, t.preview, t.streamable,
                           ROW_NUMBER() OVER (PARTITION BY pt.playlist_id ORDER BY pt.position ASC) AS rn
                    FROM playlist_tracks pt
                    JOIN tracks t ON t.id = pt.track_id
                )
                WHERE rn <= ?
                ORDER BY playlist_id ASC, rn ASC
                """;
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setInt(1, limit);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    result.computeIfAbsent(rs.getString("playlist_id"), key -> new ArrayList<>())
                            .add(mapTrack(rs));
                }
            }
            return result;
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized List<Track> playlistTracks(String playlistId) {
        String sql = "SELECT t.* FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id " +
                "WHERE pt.playlist_id = ? ORDER BY pt.position ASC";
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, playlistId);
            return readTracks(ps);
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized int playlistTrackCount(String playlistId) {
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?")) {
            ps.setString(1, playlistId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getInt(1) : 0;
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void addPlaylistTrack(String playlistId, Track track) {
        upsertTrack(track);
        try (PreparedStatement ps = connection.prepareStatement("""
                INSERT INTO playlist_tracks(playlist_id, track_id, position, added_at)
                VALUES(?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM playlist_tracks WHERE playlist_id = ?), ?)
                ON CONFLICT(playlist_id, track_id) DO NOTHING
                """)) {
            ps.setString(1, playlistId);
            ps.setString(2, track.id());
            ps.setString(3, playlistId);
            ps.setLong(4, System.currentTimeMillis());
            ps.executeUpdate();
            touchPlaylist(playlistId);
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void removePlaylistTrack(String playlistId, String trackId) {
        try (PreparedStatement ps = connection.prepareStatement(
                "DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?")) {
            ps.setString(1, playlistId);
            ps.setString(2, trackId);
            ps.executeUpdate();
            touchPlaylist(playlistId);
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    private void touchPlaylist(String playlistId) throws SQLException {
        try (PreparedStatement ps = connection.prepareStatement(
                "UPDATE playlists SET updated_at = ? WHERE id = ?")) {
            ps.setLong(1, System.currentTimeMillis());
            ps.setString(2, playlistId);
            ps.executeUpdate();
        }
    }

    public synchronized void deletePlaylist(String id) {
        try (PreparedStatement ps = connection.prepareStatement("DELETE FROM playlists WHERE id = ?")) {
            ps.setString(1, id);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized Optional<LyricsRecord> lyrics(String trackId) {
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT plain, synced, instrumental, found, fetched_at FROM lyrics WHERE track_id = ?")) {
            ps.setString(1, trackId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return Optional.empty();
                return Optional.of(new LyricsRecord(
                        rs.getString("plain"),
                        rs.getString("synced"),
                        rs.getInt("instrumental") == 1,
                        rs.getInt("found") == 1,
                        rs.getLong("fetched_at")));
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void saveLyrics(String trackId, LyricsRecord record) {
        try (PreparedStatement ps = connection.prepareStatement("""
                INSERT INTO lyrics(track_id, plain, synced, instrumental, found, fetched_at)
                VALUES(?, ?, ?, ?, ?, ?)
                ON CONFLICT(track_id) DO UPDATE SET
                    plain = excluded.plain,
                    synced = excluded.synced,
                    instrumental = excluded.instrumental,
                    found = excluded.found,
                    fetched_at = excluded.fetched_at
                """)) {
            ps.setString(1, trackId);
            ps.setString(2, record.plain());
            ps.setString(3, record.synced());
            ps.setInt(4, record.instrumental() ? 1 : 0);
            ps.setInt(5, record.found() ? 1 : 0);
            ps.setLong(6, record.fetchedAt());
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void createAccount(AccountRow account) {
        try (PreparedStatement ps = connection.prepareStatement("""
                INSERT INTO accounts(id, username, display_name, avatar, role, password_hash,
                                     password_salt, iterations, created_at, updated_at)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """)) {
            ps.setString(1, account.id());
            ps.setString(2, account.username());
            ps.setString(3, account.displayName());
            ps.setString(4, account.avatar());
            ps.setString(5, account.role());
            ps.setString(6, account.passwordHash());
            ps.setString(7, account.passwordSalt());
            ps.setInt(8, account.iterations());
            ps.setLong(9, account.createdAt());
            ps.setLong(10, account.updatedAt());
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("Не удалось создать аккаунт", e);
        }
    }

    public synchronized Optional<AccountRow> accountByUsername(String username) {
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT * FROM accounts WHERE username = ?")) {
            ps.setString(1, username);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(mapAccount(rs)) : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized Optional<AccountRow> accountById(String id) {
        try (PreparedStatement ps = connection.prepareStatement("SELECT * FROM accounts WHERE id = ?")) {
            ps.setString(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(mapAccount(rs)) : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void updateAccountProfile(String id, String displayName, String avatar) {
        try (PreparedStatement ps = connection.prepareStatement(
                "UPDATE accounts SET display_name = ?, avatar = ?, updated_at = ? WHERE id = ?")) {
            ps.setString(1, displayName);
            ps.setString(2, avatar);
            ps.setLong(3, System.currentTimeMillis());
            ps.setString(4, id);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized List<AccountRow> accountsAll(int limit) {
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT * FROM accounts ORDER BY created_at DESC, rowid DESC LIMIT ?")) {
            ps.setInt(1, limit);
            try (ResultSet rs = ps.executeQuery()) {
                List<AccountRow> result = new ArrayList<>();
                while (rs.next()) {
                    result.add(mapAccount(rs));
                }
                return result;
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized Map<String, Integer> accountRoleCounts() {
        Map<String, Integer> result = new LinkedHashMap<>();
        result.put("user", 0);
        result.put("admin", 0);
        result.put("owner", 0);
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT role, COUNT(*) AS total FROM accounts GROUP BY role");
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                result.put(rs.getString("role"), rs.getInt("total"));
            }
            return result;
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void promoteOwner(String id, String displayName, String passwordHash,
                                          String passwordSalt, int iterations, long now) {
        try (PreparedStatement ps = connection.prepareStatement("""
                UPDATE accounts SET role = 'owner', display_name = ?, password_hash = ?,
                    password_salt = ?, iterations = ?, updated_at = ?
                WHERE id = ?
                """)) {
            ps.setString(1, displayName);
            ps.setString(2, passwordHash);
            ps.setString(3, passwordSalt);
            ps.setInt(4, iterations);
            ps.setLong(5, now);
            ps.setString(6, id);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void updateAccountRole(String id, String role, long now) {
        try (PreparedStatement ps = connection.prepareStatement(
                "UPDATE accounts SET role = ?, updated_at = ? WHERE id = ?")) {
            ps.setString(1, role);
            ps.setLong(2, now);
            ps.setString(3, id);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void deleteAccount(String id) {
        try (PreparedStatement ps = connection.prepareStatement("DELETE FROM accounts WHERE id = ?")) {
            ps.setString(1, id);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void createAccessKey(AccessKeyRow key) {
        try (PreparedStatement ps = connection.prepareStatement("""
                INSERT INTO access_keys(id, code_hash, role, note, hint, created_by, created_at)
                VALUES(?, ?, ?, ?, ?, ?, ?)
                """)) {
            ps.setString(1, key.id());
            ps.setString(2, key.codeHash());
            ps.setString(3, key.role());
            ps.setString(4, key.note());
            ps.setString(5, key.hint());
            ps.setString(6, key.createdBy());
            ps.setLong(7, key.createdAt());
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException("Не удалось создать ключ", e);
        }
    }

    public synchronized Optional<AccessKeyRow> accessKeyByHash(String codeHash) {
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT * FROM access_keys WHERE code_hash = ?")) {
            ps.setString(1, codeHash);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(mapAccessKey(rs)) : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized Optional<AccessKeyRow> accessKeyById(String id) {
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT * FROM access_keys WHERE id = ?")) {
            ps.setString(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(mapAccessKey(rs)) : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized List<AccessKeyView> accessKeyViews(int limit) {
        try (PreparedStatement ps = connection.prepareStatement("""
                SELECT k.*, c.username AS creator, r.username AS redeemer
                FROM access_keys k
                LEFT JOIN accounts c ON c.id = k.created_by
                LEFT JOIN accounts r ON r.id = k.redeemed_by
                ORDER BY k.created_at DESC, k.rowid DESC LIMIT ?
                """)) {
            ps.setInt(1, limit);
            try (ResultSet rs = ps.executeQuery()) {
                List<AccessKeyView> result = new ArrayList<>();
                while (rs.next()) {
                    Long redeemedAt = nullableLong(rs, "redeemed_at");
                    Long revokedAt = nullableLong(rs, "revoked_at");
                    result.add(new AccessKeyView(
                            rs.getString("id"),
                            rs.getString("role"),
                            rs.getString("note"),
                            rs.getString("hint"),
                            rs.getString("creator"),
                            rs.getString("redeemer"),
                            rs.getLong("created_at"),
                            redeemedAt,
                            rs.getInt("revoked") == 1,
                            revokedAt));
                }
                return result;
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized Map<String, Integer> accessKeyStatusCounts() {
        Map<String, Integer> result = new LinkedHashMap<>();
        result.put("active", 0);
        result.put("redeemed", 0);
        result.put("revoked", 0);
        try (PreparedStatement ps = connection.prepareStatement("""
                SELECT
                    SUM(CASE WHEN revoked = 1 THEN 1 ELSE 0 END) AS revoked_count,
                    SUM(CASE WHEN revoked = 0 AND redeemed_by IS NOT NULL THEN 1 ELSE 0 END) AS redeemed_count,
                    SUM(CASE WHEN revoked = 0 AND redeemed_by IS NULL THEN 1 ELSE 0 END) AS active_count
                FROM access_keys
                """);
             ResultSet rs = ps.executeQuery()) {
            if (rs.next()) {
                result.put("revoked", rs.getInt("revoked_count"));
                result.put("redeemed", rs.getInt("redeemed_count"));
                result.put("active", rs.getInt("active_count"));
            }
            return result;
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized boolean redeemAccessKey(String codeHash, String accountId, long now) {
        try (PreparedStatement ps = connection.prepareStatement("""
                UPDATE access_keys SET redeemed_by = ?, redeemed_at = ?
                WHERE code_hash = ? AND revoked = 0 AND redeemed_by IS NULL
                """)) {
            ps.setString(1, accountId);
            ps.setLong(2, now);
            ps.setString(3, codeHash);
            return ps.executeUpdate() > 0;
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized boolean revokeAccessKey(String id, long now) {
        try (PreparedStatement ps = connection.prepareStatement(
                "UPDATE access_keys SET revoked = 1, revoked_at = ? WHERE id = ? AND revoked = 0")) {
            ps.setLong(1, now);
            ps.setString(2, id);
            return ps.executeUpdate() > 0;
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    private static AccessKeyRow mapAccessKey(ResultSet rs) throws SQLException {
        return new AccessKeyRow(
                rs.getString("id"),
                rs.getString("code_hash"),
                rs.getString("role"),
                rs.getString("note"),
                rs.getString("hint"),
                rs.getString("created_by"),
                rs.getString("redeemed_by"),
                rs.getLong("created_at"),
                nullableLong(rs, "redeemed_at"),
                rs.getInt("revoked") == 1,
                nullableLong(rs, "revoked_at"));
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    private static AccountRow mapAccount(ResultSet rs) throws SQLException {
        return new AccountRow(
                rs.getString("id"),
                rs.getString("username"),
                rs.getString("display_name"),
                rs.getString("avatar"),
                rs.getString("role"),
                rs.getString("password_hash"),
                rs.getString("password_salt"),
                rs.getInt("iterations"),
                rs.getLong("created_at"),
                rs.getLong("updated_at"));
    }

    public synchronized void createSession(String tokenHash, String accountId, long createdAt, long expiresAt) {
        try (PreparedStatement ps = connection.prepareStatement(
                "INSERT INTO sessions(token_hash, account_id, created_at, expires_at) VALUES(?, ?, ?, ?)")) {
            ps.setString(1, tokenHash);
            ps.setString(2, accountId);
            ps.setLong(3, createdAt);
            ps.setLong(4, expiresAt);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized Optional<AccountRow> accountForSession(String tokenHash, long now) {
        try (PreparedStatement ps = connection.prepareStatement("""
                SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id
                WHERE s.token_hash = ? AND s.expires_at > ?
                """)) {
            ps.setString(1, tokenHash);
            ps.setLong(2, now);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(mapAccount(rs)) : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void deleteSession(String tokenHash) {
        try (PreparedStatement ps = connection.prepareStatement(
                "DELETE FROM sessions WHERE token_hash = ?")) {
            ps.setString(1, tokenHash);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void deleteExpiredSessions(long now) {
        try (PreparedStatement ps = connection.prepareStatement(
                "DELETE FROM sessions WHERE expires_at <= ?")) {
            ps.setLong(1, now);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized Map<String, String> settings() {
        Map<String, String> result = new LinkedHashMap<>(DEFAULT_SETTINGS);
        try (PreparedStatement ps = connection.prepareStatement("SELECT key, value FROM settings");
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                result.put(rs.getString("key"), rs.getString("value"));
            }
            return result;
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    public synchronized void setSetting(String key, String value) {
        try (PreparedStatement ps = connection.prepareStatement(
                "INSERT INTO settings(key, value) VALUES(?, ?) " +
                        "ON CONFLICT(key) DO UPDATE SET value = excluded.value")) {
            ps.setString(1, key);
            ps.setString(2, value);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    private List<Track> readTracks(PreparedStatement ps) throws SQLException {
        try (ResultSet rs = ps.executeQuery()) {
            List<Track> result = new ArrayList<>();
            while (rs.next()) {
                result.add(mapTrack(rs));
            }
            return result;
        }
    }

    private Track mapTrack(ResultSet rs) throws SQLException {
        String id = rs.getString("id");
        String artwork = trackCovers.getOrDefault(id, rs.getString("artwork_url"));
        return new Track(
                id,
                rs.getString("provider"),
                rs.getString("external_id"),
                rs.getString("title"),
                rs.getString("artist"),
                rs.getString("album"),
                rs.getLong("duration_ms"),
                artwork,
                rs.getString("color"),
                rs.getInt("preview") == 1,
                rs.getInt("streamable") == 1);
    }

    @Override
    public synchronized void close() {
        try {
            connection.close();
        } catch (SQLException ignored) {
            // shutting down
        }
    }

    public record Playlist(
            String id,
            String name,
            String cover,
            String description,
            long createdAt,
            long updatedAt) {
    }

    public record AccountRow(
            String id,
            String username,
            String displayName,
            String avatar,
            String role,
            String passwordHash,
            String passwordSalt,
            int iterations,
            long createdAt,
            long updatedAt) {
    }

    public record AccessKeyRow(
            String id,
            String codeHash,
            String role,
            String note,
            String hint,
            String createdBy,
            String redeemedBy,
            long createdAt,
            Long redeemedAt,
            boolean revoked,
            Long revokedAt) {
    }

    public record AccessKeyView(
            String id,
            String role,
            String note,
            String hint,
            String createdBy,
            String redeemedBy,
            long createdAt,
            Long redeemedAt,
            boolean revoked,
            Long revokedAt) {
    }

    public record LyricsRecord(
            String plain,
            String synced,
            boolean instrumental,
            boolean found,
            long fetchedAt) {
    }
}
