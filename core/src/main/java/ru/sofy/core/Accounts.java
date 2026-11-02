package ru.sofy.core;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Local accounts: passwords are stretched with PBKDF2-HMAC-SHA256 and stored
 * only as salted hashes. Session tokens are returned once and stored hashed.
 */
public final class Accounts {
    public static final String ROLE_USER = "user";
    public static final String ROLE_ADMIN = "admin";
    public static final String ROLE_OWNER = "owner";
    private static final Set<String> ROLES = Set.of(ROLE_USER, ROLE_ADMIN, ROLE_OWNER);
    private static final Set<String> KEY_ROLES = Set.of(ROLE_USER, ROLE_ADMIN);

    private static final int ITERATIONS = 210_000;
    private static final int SALT_BYTES = 16;
    private static final int KEY_BITS = 256;
    private static final long SESSION_TTL_MS = 30L * 24 * 60 * 60 * 1000;
    private static final int MAX_AVATAR_CHARS = 760_000;
    private static final int MAX_KEY_NOTE = 60;
    private static final String KEY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    private static final Pattern USERNAME = Pattern.compile("[a-z0-9][a-z0-9._-]{1,22}[a-z0-9]");
    private static final Pattern AVATAR = Pattern.compile(
            "data:image/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}",
            Pattern.CASE_INSENSITIVE);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final byte[] DUMMY_SALT = randomBytes(SALT_BYTES);

    private static final String OWNER_USERNAME = "whyldfx1k";
    private static final String OWNER_NAME = "Michael";
    private static final int OWNER_ITERATIONS = 210_000;
    private static final String OWNER_SALT = "/mbfQs/DdMkj/Nuo/chJrg==";
    private static final String OWNER_HASH = "XET5uHDdRMmrTKhrot9OJv0P/y5byaR+mLB5fceUg28=";

    private final Db db;

    public Accounts(Db db) {
        this.db = db;
        db.deleteExpiredSessions(System.currentTimeMillis());
        seedOwner();
    }

    public record Account(String id, String username, String displayName, String avatar, String role,
                          long createdAt, long updatedAt) {
    }

    public record SignedIn(Account account, String token) {
    }

    public SignedIn register(String usernameRaw, String displayNameRaw, String password,
                             String accessKeyRaw) {
        String username = normalizeUsername(usernameRaw);
        String displayName = normalizeDisplayName(displayNameRaw, username);
        validatePassword(password);
        Db.AccessKeyRow accessKey = accessKeyRaw == null || accessKeyRaw.isBlank()
                ? null
                : activeKey(accessKeyRaw);
        String role = accessKey == null ? ROLE_USER : accessKey.role();
        if (db.accountByUsername(username).isPresent()) {
            throw new ApiException(409, "Этот логин уже занят");
        }
        byte[] salt = randomBytes(SALT_BYTES);
        String hash = base64(derive(password, salt, ITERATIONS));
        long now = System.currentTimeMillis();
        Db.AccountRow row = new Db.AccountRow(
                UUID.randomUUID().toString(), username, displayName, null, role,
                hash, base64(salt), ITERATIONS, now, now);
        db.createAccount(row);
        if (accessKey != null && !db.redeemAccessKey(accessKey.codeHash(), row.id(), now)) {
            db.deleteAccount(row.id());
            throw new ApiException(409, "Ключ доступа уже использован");
        }
        return new SignedIn(publicAccount(row), issueSession(row.id()));
    }

    public Account redeemAccessKey(String token, String rawKey) {
        Db.AccountRow account = accountRow(token);
        if (!ROLE_USER.equals(account.role())) {
            throw new ApiException(400, "У вас уже есть роль " + roleLabel(account.role()));
        }
        Db.AccessKeyRow key = activeKey(rawKey);
        long now = System.currentTimeMillis();
        if (!db.redeemAccessKey(key.codeHash(), account.id(), now)) {
            throw new ApiException(409, "Ключ доступа уже использован");
        }
        if (ROLE_ADMIN.equals(key.role())) {
            db.updateAccountRole(account.id(), ROLE_ADMIN, now);
        }
        return publicAccount(db.accountById(account.id()).orElseThrow());
    }

    public Map<String, Object> adminOverview(String token) {
        Account actor = requireRole(token, ROLE_ADMIN, ROLE_OWNER);
        Map<String, Integer> roles = db.accountRoleCounts();
        Map<String, Integer> keys = db.accessKeyStatusCounts();

        List<Account> accounts = new ArrayList<>();
        for (Db.AccountRow row : db.accountsAll(500)) {
            accounts.add(publicAccount(row));
        }

        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("accounts", roles.values().stream().mapToInt(Integer::intValue).sum());
        stats.put("owners", roles.getOrDefault(ROLE_OWNER, 0));
        stats.put("admins", roles.getOrDefault(ROLE_ADMIN, 0));
        stats.put("users", roles.getOrDefault(ROLE_USER, 0));
        stats.put("keysActive", keys.getOrDefault("active", 0));
        stats.put("keysRedeemed", keys.getOrDefault("redeemed", 0));
        stats.put("keysRevoked", keys.getOrDefault("revoked", 0));

        boolean owner = ROLE_OWNER.equals(actor.role());
        Map<String, Object> capabilities = new LinkedHashMap<>();
        capabilities.put("manageRoles", owner);
        capabilities.put("createAdminKeys", owner);
        capabilities.put("revokeAnyKey", owner);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("stats", stats);
        result.put("accounts", accounts);
        result.put("keys", db.accessKeyViews(300));
        result.put("capabilities", capabilities);
        return result;
    }

    public Map<String, Object> createAccessKey(String token, String roleRaw, String noteRaw) {
        Account actor = requireRole(token, ROLE_ADMIN, ROLE_OWNER);
        String role = normalizeKeyRole(roleRaw);
        if (ROLE_ADMIN.equals(role) && !ROLE_OWNER.equals(actor.role())) {
            throw new ApiException(403, "Только владелец может выдавать ключи администратора");
        }
        String note = normalizeNote(noteRaw);
        String rawKey = generateKey();
        String hint = rawKey.substring(rawKey.length() - 4);
        long now = System.currentTimeMillis();
        String id = UUID.randomUUID().toString();
        db.createAccessKey(new Db.AccessKeyRow(
                id, sha256(rawKey), role, note, hint, actor.id(), null, now, null, false, null));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("key", rawKey);
        result.put("accessKey", new Db.AccessKeyView(
                id, role, note, hint, actor.username(), null, now, null, false, null));
        return result;
    }

    public void revokeAccessKey(String token, String id) {
        Account actor = requireRole(token, ROLE_ADMIN, ROLE_OWNER);
        Db.AccessKeyRow key = db.accessKeyById(id)
                .orElseThrow(() -> new ApiException(404, "Ключ не найден"));
        if (key.revoked()) return;
        if (!ROLE_OWNER.equals(actor.role())) {
            if (!actor.id().equals(key.createdBy())) {
                throw new ApiException(403, "Можно отзывать только свои ключи");
            }
            if (ROLE_ADMIN.equals(key.role())) {
                throw new ApiException(403, "Ключи администратора отзывает владелец");
            }
        }
        db.revokeAccessKey(id, System.currentTimeMillis());
    }

    public Account setRole(String token, String accountId, String roleRaw) {
        Account actor = requireRole(token, ROLE_OWNER);
        String role = normalizeRole(roleRaw);
        if (ROLE_OWNER.equals(role)) {
            throw new ApiException(400, "Роль владельца назначается только при запуске");
        }
        if (actor.id().equals(accountId)) {
            throw new ApiException(400, "Нельзя изменить собственную роль");
        }
        Db.AccountRow target = db.accountById(accountId)
                .orElseThrow(() -> new ApiException(404, "Аккаунт не найден"));
        if (ROLE_OWNER.equals(target.role())) {
            throw new ApiException(400, "Роль владельца изменить нельзя");
        }
        db.updateAccountRole(accountId, role, System.currentTimeMillis());
        return publicAccount(db.accountById(accountId).orElseThrow());
    }

    private void seedOwner() {
        Optional<Db.AccountRow> existing = db.accountByUsername(OWNER_USERNAME);
        long now = System.currentTimeMillis();
        if (existing.isEmpty()) {
            db.createAccount(new Db.AccountRow(
                    UUID.randomUUID().toString(), OWNER_USERNAME, OWNER_NAME, null, ROLE_OWNER,
                    OWNER_HASH, OWNER_SALT, OWNER_ITERATIONS, now, now));
            return;
        }
        Db.AccountRow row = existing.get();
        if (!ROLE_OWNER.equals(row.role())) {
            db.promoteOwner(row.id(), OWNER_NAME, OWNER_HASH, OWNER_SALT, OWNER_ITERATIONS, now);
        }
    }

    private Db.AccountRow accountRow(String token) {
        Account account = session(token)
                .orElseThrow(() -> new ApiException(401, "Требуется вход в аккаунт"));
        return db.accountById(account.id())
                .orElseThrow(() -> new ApiException(401, "Требуется вход в аккаунт"));
    }

    private Account requireRole(String token, String... roles) {
        Account account = session(token)
                .orElseThrow(() -> new ApiException(401, "Требуется вход в аккаунт"));
        for (String role : roles) {
            if (role.equals(account.role())) return account;
        }
        throw new ApiException(403, "Недостаточно прав");
    }

    private Db.AccessKeyRow activeKey(String raw) {
        String hashCode = sha256(normalizeKey(raw));
        Db.AccessKeyRow key = db.accessKeyByHash(hashCode)
                .orElseThrow(() -> new ApiException(400, "Ключ доступа недействителен"));
        if (key.revoked() || key.redeemedBy() != null || !KEY_ROLES.contains(key.role())) {
            throw new ApiException(400, "Ключ доступа уже использован или отозван");
        }
        return key;
    }

    private static String generateKey() {
        StringBuilder compact = new StringBuilder(20).append("SOFY");
        for (int i = 0; i < 16; i += 1) {
            compact.append(KEY_ALPHABET.charAt(RANDOM.nextInt(KEY_ALPHABET.length())));
        }
        String value = compact.toString();
        return value.substring(0, 4) + "-" + value.substring(4, 8) + "-"
                + value.substring(8, 12) + "-" + value.substring(12, 16) + "-"
                + value.substring(16, 20);
    }

    private static String normalizeKey(String raw) {
        if (raw == null) throw new ApiException(400, "Введите ключ доступа");
        String compact = raw.trim().toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
        if (compact.length() != 20 || !compact.startsWith("SOFY")
                || !compact.substring(4).matches("[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{16}")) {
            throw new ApiException(400, "Некорректный ключ доступа");
        }
        return "SOFY-" + compact.substring(4, 8) + "-" + compact.substring(8, 12) + "-"
                + compact.substring(12, 16) + "-" + compact.substring(16, 20);
    }

    private static String normalizeRole(String raw) {
        String role = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
        if (!ROLES.contains(role)) throw new ApiException(400, "Неизвестная роль");
        return role;
    }

    private static String normalizeKeyRole(String raw) {
        String role = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
        if (!KEY_ROLES.contains(role)) {
            throw new ApiException(400, "Ключ может быть только для пользователя или администратора");
        }
        return role;
    }

    private static String normalizeNote(String raw) {
        if (raw == null) return null;
        String note = raw.replaceAll("[\\p{Cntrl}]", "").trim();
        if (note.isEmpty()) return null;
        if (note.length() > MAX_KEY_NOTE) {
            throw new ApiException(400, "Заметка не должна превышать " + MAX_KEY_NOTE + " символов");
        }
        return note;
    }

    private static String roleLabel(String role) {
        return switch (role) {
            case ROLE_ADMIN -> "администратора";
            case ROLE_OWNER -> "владельца";
            default -> "пользователя";
        };
    }

    public SignedIn login(String usernameRaw, String password) {
        String username = "";
        try {
            username = normalizeUsername(usernameRaw);
        } catch (ApiException ignored) {
            // fall through to the generic credentials error
        }
        String safePassword = password == null ? "" : password;
        Optional<Db.AccountRow> found = username.isEmpty() ? Optional.empty() : db.accountByUsername(username);

        // Always derive once so a missing account is not distinguishable by timing.
        byte[] salt = found.map(row -> decode(row.passwordSalt())).orElse(DUMMY_SALT);
        int iterations = found.map(Db.AccountRow::iterations).orElse(ITERATIONS);
        byte[] candidate = derive(safePassword, salt, iterations);
        if (found.isEmpty() || !MessageDigest.isEqual(candidate, decode(found.get().passwordHash()))) {
            throw new ApiException(401, "Неверный логин или пароль");
        }
        Db.AccountRow row = found.get();
        return new SignedIn(publicAccount(row), issueSession(row.id()));
    }

    public Optional<Account> session(String token) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{32,128}")) return Optional.empty();
        long now = System.currentTimeMillis();
        Optional<Db.AccountRow> row = db.accountForSession(sha256(token), now);
        return row.map(Accounts::publicAccount);
    }

    public void logout(String token) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{32,128}")) return;
        db.deleteSession(sha256(token));
    }

    public Account updateProfile(String token, boolean hasDisplayName, String displayNameRaw,
                                 boolean hasAvatar, String avatarRaw) {
        Db.AccountRow row = session(token).flatMap(account -> db.accountById(account.id()))
                .orElseThrow(() -> new ApiException(401, "Требуется вход в аккаунт"));
        String displayName = row.displayName();
        String avatar = row.avatar();
        if (hasDisplayName) {
            displayName = normalizeDisplayName(displayNameRaw, row.username());
        }
        if (hasAvatar) {
            avatar = normalizeAvatar(avatarRaw);
        }
        db.updateAccountProfile(row.id(), displayName, avatar);
        return publicAccount(db.accountById(row.id()).orElseThrow());
    }

    private String issueSession(String accountId) {
        byte[] raw = randomBytes(32);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        long now = System.currentTimeMillis();
        db.createSession(sha256(token), accountId, now, now + SESSION_TTL_MS);
        return token;
    }

    private static Account publicAccount(Db.AccountRow row) {
        return new Account(row.id(), row.username(), row.displayName(), row.avatar(), row.role(),
                row.createdAt(), row.updatedAt());
    }

    private static String normalizeUsername(String raw) {
        if (raw == null) throw new ApiException(400, "Введите логин");
        String username = raw.trim().toLowerCase(Locale.ROOT);
        if (username.startsWith("@")) username = username.substring(1);
        if (!USERNAME.matcher(username).matches()) {
            throw new ApiException(400, "Логин: 3–24 символа, латиница, цифры, точка, дефис или _");
        }
        return username;
    }

    private static String normalizeDisplayName(String raw, String fallback) {
        String name = raw == null ? "" : raw.replaceAll("[\\p{Cntrl}]", "").trim();
        if (name.isEmpty()) name = fallback;
        if (name.length() > 40) throw new ApiException(400, "Имя не должно превышать 40 символов");
        return name;
    }

    private static void validatePassword(String password) {
        if (password == null || password.length() < 8) {
            throw new ApiException(400, "Пароль должен быть не короче 8 символов");
        }
        if (password.length() > 128) {
            throw new ApiException(400, "Пароль слишком длинный");
        }
    }

    private static String normalizeAvatar(String raw) {
        if (raw == null) return null;
        String avatar = raw.trim();
        if (avatar.length() > MAX_AVATAR_CHARS || !AVATAR.matcher(avatar).matches()) {
            throw new ApiException(400, "Некорректное изображение профиля");
        }
        return avatar;
    }

    private static byte[] derive(String password, byte[] salt, int iterations) {
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, iterations, KEY_BITS);
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                    .generateSecret(spec)
                    .getEncoded();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Не удалось защитить пароль", e);
        } finally {
            spec.clearPassword();
        }
    }

    private static String sha256(String value) {
        try {
            return base64(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] randomBytes(int size) {
        byte[] bytes = new byte[size];
        RANDOM.nextBytes(bytes);
        return bytes;
    }

    private static String base64(byte[] bytes) {
        return Base64.getEncoder().encodeToString(bytes);
    }

    private static byte[] decode(String value) {
        return Base64.getDecoder().decode(value);
    }
}
