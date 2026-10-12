<?php
declare(strict_types=1);

// Never print PHP notices/warnings into API responses (they would corrupt the JSON); log them instead.
ini_set('display_errors', '0');

/**
 * Admin API for samvelmheryan.am.
 *
 * Login is a plain username + password. The GitHub token never leaves this
 * file's server-side config; the browser only ever talks to this script.
 *
 * Config lives OUTSIDE the web root (see admin-config.sample.php).
 */

const CONTENT_PATH = 'content/site.json';
const UPLOAD_DIR = 'public/images/uploads';
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const MAX_ITEMS = 300;
const LANGS = ['hy', 'en', 'ru'];

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(array $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $status = 400): never
{
    respond(['error' => $message], $status);
}

// ── Config ──────────────────────────────────────────────────────────────────

function load_config(): array
{
    $path = getenv('SAMVEL_ADMIN_CONFIG')
        ?: dirname(rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/')) . '/samvel-admin-config.php';
    if (!is_file($path)) {
        fail('Admin is not configured on this server yet.', 500);
    }
    $config = require $path;
    foreach (['username', 'password_hash'] as $key) {
        if (empty($config[$key])) {
            fail("Admin config is missing '$key'.", 500);
        }
    }
    if (empty($config['dry_run_root'])) {
        foreach (['github_token', 'github_repo', 'github_branch'] as $key) {
            if (empty($config[$key])) {
                fail("Admin config is missing '$key'.", 500);
            }
        }
    }
    return $config;
}

$config = load_config();

// ── Session / auth ──────────────────────────────────────────────────────────

$isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/admin/',
    'secure' => $isHttps,
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_name('samvel_admin');
session_start();

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

function is_logged_in(): bool
{
    return !empty($_SESSION['auth']) && (time() - ($_SESSION['last_seen'] ?? 0)) < 8 * 3600;
}

function require_auth(): void
{
    if (!is_logged_in()) {
        fail('Not logged in.', 401);
    }
    $_SESSION['last_seen'] = time();
}

function require_csrf(): void
{
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $sent)) {
        fail('Session expired. Please reload the page.', 403);
    }
}

function throttle_file(): string
{
    return sys_get_temp_dir() . '/samvel_admin_' . sha1($_SERVER['REMOTE_ADDR'] ?? 'unknown') . '.json';
}

function throttle_state(): array
{
    $raw = @file_get_contents(throttle_file());
    $state = $raw ? json_decode($raw, true) : null;
    if (!is_array($state) || ($state['until'] ?? 0) < time() && ($state['window'] ?? 0) < time() - 900) {
        return ['fails' => 0, 'window' => time(), 'until' => 0];
    }
    return $state;
}

function throttle_save(array $state): void
{
    @file_put_contents(throttle_file(), json_encode($state), LOCK_EX);
}

// ── Content validation ──────────────────────────────────────────────────────

function clean_text(mixed $v, int $max = 300): string
{
    if (!is_string($v)) {
        return '';
    }
    $v = trim(preg_replace('/\s+/u', ' ', $v) ?? '');
    return mb_substr($v, 0, $max);
}

function clean_image(mixed $v): string
{
    if (!is_string($v) || !preg_match('#^/images/[A-Za-z0-9._/-]+\.webp$#', $v) || str_contains($v, '..') || str_contains($v, '//')) {
        fail('Invalid image path.');
    }
    return $v;
}

function clean_image_optional(mixed $v): string
{
    return (is_string($v) && trim($v) === '') || $v === null ? '' : clean_image($v);
}

const RESERVED_SLUGS = ['gallery', 'admin', 'images', 'index', '404', 'uploads'];

function clean_slug(mixed $v, array &$seen): string
{
    $v = is_string($v) ? trim($v) : '';
    if (!preg_match('/^[a-z0-9][a-z0-9-]{0,59}$/', $v) || in_array($v, RESERVED_SLUGS, true)) {
        fail('Invalid page address.');
    }
    if (isset($seen[$v])) {
        fail('Two items share the same page address.');
    }
    $seen[$v] = true;
    return $v;
}

/** Accepts a bare 11-character YouTube id or a youtube.com / youtu.be link; returns the id. */
function clean_youtube(mixed $v): string
{
    $v = is_string($v) ? trim($v) : '';
    if ($v === '') {
        return '';
    }
    if (preg_match('/^[A-Za-z0-9_-]{11}$/', $v)) {
        return $v;
    }
    if (preg_match('~^https://(?:www\.|m\.)?(?:youtube\.com/(?:watch\?(?:[^#]*&)?v=|embed/|shorts/)|youtu\.be/)([A-Za-z0-9_-]{11})(?:[?&#/].*)?$~', $v, $m)) {
        return $m[1];
    }
    fail('The YouTube link is not valid.');
}

function clean_url(mixed $v, string $label): string
{
    $v = is_string($v) ? trim($v) : '';
    if (!preg_match('#^https://[^\s<>"\']+$#i', $v) || filter_var($v, FILTER_VALIDATE_URL) === false) {
        fail("$label: link must start with https://");
    }
    return $v;
}

/** Armenian is mandatory, English and Russian optional. */
function clean_trilingual(mixed $v, string $label, int $max = 200, bool $required = true): array
{
    $v = is_array($v) ? $v : [];
    $out = [];
    foreach (LANGS as $lang) {
        $out[$lang] = clean_text($v[$lang] ?? '', $max);
    }
    if ($out['hy'] === '' && ($required || $out['en'] !== '' || $out['ru'] !== '')) {
        fail("$label: the Armenian text is required.");
    }
    return $out;
}

function clean_list(mixed $v, string $label): array
{
    if (!is_array($v) || !array_is_list($v)) {
        fail("$label: invalid list.");
    }
    if (count($v) > MAX_ITEMS) {
        fail("$label: too many items.");
    }
    return $v;
}

function clean_content(mixed $in): array
{
    if (!is_array($in)) {
        fail('Invalid content.');
    }

    $banners = [];
    foreach (clean_list($in['banners'] ?? [], 'Banners') as $b) {
        $banners[] = ['image' => clean_image($b['image'] ?? null)];
    }
    if (!$banners) {
        fail('Banners: at least one banner is required.');
    }

    $seenSlugs = [];
    $cards = static function (mixed $list, string $label, bool $isBook) use (&$seenSlugs): array {
        $out = [];
        foreach (clean_list($list, $label) as $i => $item) {
            $n = $i + 1;
            $name = "$label #$n";
            $d = is_array($item['detail'] ?? null) ? $item['detail'] : [];

            $paragraphs = [];
            foreach (clean_list($d['paragraphs'] ?? [], "$name text") as $pi => $p) {
                $paragraphs[] = clean_trilingual($p, "$name paragraph " . ($pi + 1), 5000);
            }

            $sections = [];
            foreach (clean_list($d['sections'] ?? [], "$name sections") as $si => $sec) {
                $images = [];
                foreach (clean_list($sec['images'] ?? [], "$name section") as $img) {
                    $images[] = ['image' => clean_image($img['image'] ?? null)];
                }
                $sections[] = [
                    'label' => clean_trilingual($sec['label'] ?? [], "$name section " . ($si + 1) . ' title'),
                    'images' => $images,
                ];
            }

            $out[] = [
                'image' => clean_image($item['image'] ?? null),
                'title' => clean_trilingual($item['title'] ?? [], $name),
                'slug' => clean_slug($item['slug'] ?? '', $seenSlugs),
                'page' => !empty($item['page']),
                'detail' => [
                    'bg' => clean_image_optional($d['bg'] ?? '') ?: ($isBook ? '/images/books-bg.webp' : '/images/films-bg.webp'),
                    'genre' => clean_trilingual($d['genre'] ?? [], "$name subtitle", 200, false),
                    'meta' => clean_trilingual($d['meta'] ?? [], "$name details line", 300, false),
                    'paragraphs' => $paragraphs,
                    'video' => clean_youtube($d['video'] ?? ''),
                    'poster' => clean_image_optional($d['poster'] ?? ''),
                    'hero' => clean_image_optional($d['hero'] ?? ''),
                    'sections' => $sections,
                ],
            ];
        }
        return $out;
    };

    $bio = [];
    foreach (clean_list($in['bio']['paragraphs'] ?? [], 'Biography') as $pi => $p) {
        $bio[] = clean_trilingual($p, 'Biography paragraph ' . ($pi + 1), 5000);
    }
    if (!$bio) {
        fail('Biography: at least one paragraph is required.');
    }

    $gallery = [];
    foreach (clean_list($in['gallery'] ?? [], 'Gallery') as $g) {
        $gallery[] = ['image' => clean_image($g['image'] ?? null)];
    }

    $c = is_array($in['contact'] ?? null) ? $in['contact'] : [];
    $email = is_string($c['email']['address'] ?? null) ? trim($c['email']['address']) : '';
    if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        fail('Contact: the email address is not valid.');
    }

    return [
        'banners' => $banners,
        'bio' => ['paragraphs' => $bio],
        'books' => $cards($in['books'] ?? [], 'Books', true),
        'films' => $cards($in['films'] ?? [], 'Films', false),
        'gallery' => $gallery,
        'contact' => [
            'facebook' => [
                'url' => clean_url($c['facebook']['url'] ?? '', 'Facebook'),
                'name' => clean_trilingual($c['facebook']['name'] ?? [], 'Facebook name'),
            ],
            'email' => ['address' => $email],
            'linkedin' => [
                'url' => clean_url($c['linkedin']['url'] ?? '', 'LinkedIn'),
                'name' => clean_trilingual($c['linkedin']['name'] ?? [], 'LinkedIn name'),
            ],
        ],
    ];
}

function referenced_images(array $content): array
{
    $refs = [];
    foreach (['banners', 'gallery'] as $section) {
        foreach ($content[$section] as $item) {
            $refs[$item['image']] = true;
        }
    }
    foreach (['books', 'films'] as $section) {
        foreach ($content[$section] as $item) {
            $d = $item['detail'];
            foreach ([$item['image'], $d['bg'], $d['poster'], $d['hero']] as $img) {
                if ($img !== '') {
                    $refs[$img] = true;
                }
            }
            foreach ($d['sections'] as $sec) {
                foreach ($sec['images'] as $img) {
                    $refs[$img['image']] = true;
                }
            }
        }
    }
    return $refs;
}

// ── GitHub (or local dry-run) storage ───────────────────────────────────────

function github(string $method, string $path, ?array $body = null): array
{
    global $config;
    $ch = curl_init(rtrim($config['github_api'] ?? 'https://api.github.com', '/') . '/repos/' . $config['github_repo'] . $path);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $config['github_token'],
            'Accept: application/vnd.github+json',
            'X-GitHub-Api-Version: 2022-11-28',
            'User-Agent: samvelmheryan-admin',
            'Content-Type: application/json',
        ],
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
    $raw = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    if ($raw === false) {
        error_log("samvel-admin: GitHub request failed: $err");
        fail('Could not reach GitHub. Please try again in a minute.', 502);
    }
    $data = json_decode((string)$raw, true);
    return ['status' => $status, 'data' => is_array($data) ? $data : []];
}

function github_ok(array $res, string $what, array $okStatuses = [200, 201]): array
{
    if (!in_array($res['status'], $okStatuses, true)) {
        error_log("samvel-admin: GitHub $what failed ({$res['status']}): " . json_encode($res['data']));
        fail("Saving failed ($what). Please try again; if it keeps failing, contact the site developer.", 502);
    }
    return $res['data'];
}

function dry_root(): ?string
{
    global $config;
    return !empty($config['dry_run_root']) ? rtrim($config['dry_run_root'], '/') : null;
}

function read_content(): array
{
    global $config;
    if ($root = dry_root()) {
        $data = json_decode((string)@file_get_contents("$root/" . CONTENT_PATH), true);
        return is_array($data) ? $data : fail('Could not read content.', 500);
    }
    $res = github('GET', '/contents/' . CONTENT_PATH . '?ref=' . rawurlencode($config['github_branch']));
    $file = github_ok($res, 'load');
    $data = json_decode((string)base64_decode((string)($file['content'] ?? '')), true);
    return is_array($data) ? $data : fail('Could not read content.', 500);
}

function list_uploads(): array
{
    global $config;
    if ($root = dry_root()) {
        return array_map('basename', glob("$root/" . UPLOAD_DIR . '/*.webp') ?: []);
    }
    $res = github('GET', '/contents/' . UPLOAD_DIR . '?ref=' . rawurlencode($config['github_branch']));
    if ($res['status'] === 404) {
        return [];
    }
    $items = github_ok($res, 'list uploads');
    return array_values(array_map(static fn($i) => (string)$i['name'], array_filter($items, static fn($i) => ($i['type'] ?? '') === 'file')));
}

function is_real_webp(string $bytes): bool
{
    return strlen($bytes) > 12 && substr($bytes, 0, 4) === 'RIFF' && substr($bytes, 8, 4) === 'WEBP';
}

/** Recursively sort keys so two equal documents compare equal regardless of key order. */
function normalize(mixed $v): mixed
{
    if (!is_array($v)) {
        return $v;
    }
    $v = array_map('normalize', $v);
    if (!array_is_list($v)) {
        ksort($v);
    }
    return $v;
}

/** Which top-level sections differ between two content documents. */
function changed_sections(array $before, array $after): array
{
    $names = ['bio' => 'biography', 'banners' => 'banners', 'books' => 'books', 'films' => 'films', 'gallery' => 'gallery', 'contact' => 'contact info'];
    $out = [];
    foreach ($names as $key => $label) {
        if (json_encode(normalize($before[$key] ?? null)) !== json_encode(normalize($after[$key] ?? null))) {
            $out[] = $label;
        }
    }
    return $out;
}

// ── Routes ──────────────────────────────────────────────────────────────────

switch ($action) {
    case 'session':
        respond([
            'loggedIn' => is_logged_in(),
            'csrf' => is_logged_in() ? ($_SESSION['csrf'] ??= bin2hex(random_bytes(32))) : null,
        ]);

    case 'login':
        if ($method !== 'POST') {
            fail('POST required.', 405);
        }
        $state = throttle_state();
        if (($state['until'] ?? 0) > time()) {
            fail('Too many attempts. Please wait a few minutes and try again.', 429);
        }
        $body = json_decode((string)file_get_contents('php://input'), true) ?: [];
        $okUser = hash_equals((string)$config['username'], (string)($body['username'] ?? ''));
        $okPass = password_verify((string)($body['password'] ?? ''), (string)$config['password_hash']);
        if (!($okUser && $okPass)) {
            $state['fails'] = ($state['fails'] ?? 0) + 1;
            if ($state['fails'] >= 5) {
                $state = ['fails' => 0, 'window' => time(), 'until' => time() + 900];
            }
            throttle_save($state);
            sleep(1);
            fail('Wrong username or password.', 401);
        }
        throttle_save(['fails' => 0, 'window' => time(), 'until' => 0]);
        session_regenerate_id(true);
        $_SESSION['auth'] = true;
        $_SESSION['last_seen'] = time();
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        respond(['ok' => true, 'csrf' => $_SESSION['csrf']]);

    case 'logout':
        require_csrf();
        $_SESSION = [];
        session_destroy();
        respond(['ok' => true]);

    case 'load':
        require_auth();
        respond(['content' => read_content()]);

    case 'upload':
        require_auth();
        require_csrf();
        if ($method !== 'POST' || empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
            fail('Upload failed. The photo may be too large.');
        }
        if ($_FILES['file']['size'] > MAX_UPLOAD_BYTES) {
            fail('The photo is too large.');
        }
        $bytes = (string)file_get_contents($_FILES['file']['tmp_name']);
        if (!is_real_webp($bytes)) {
            fail('Only WebP images are accepted (the admin page converts photos automatically).');
        }
        $name = date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.webp';
        $path = UPLOAD_DIR . '/' . $name;
        if ($root = dry_root()) {
            @mkdir("$root/" . UPLOAD_DIR, 0775, true);
            file_put_contents("$root/$path", $bytes);
            respond(['image' => '/images/uploads/' . $name, 'path' => $path, 'sha' => 'dry']);
        }
        $blob = github_ok(github('POST', '/git/blobs', ['content' => base64_encode($bytes), 'encoding' => 'base64']), 'upload');
        respond(['image' => '/images/uploads/' . $name, 'path' => $path, 'sha' => $blob['sha']]);

    case 'save':
        require_auth();
        require_csrf();
        if ($method !== 'POST') {
            fail('POST required.', 405);
        }
        $body = json_decode((string)file_get_contents('php://input'), true);
        if (!is_array($body)) {
            fail('Invalid request.');
        }
        $content = clean_content($body['content'] ?? null);
        $json = json_encode($content, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n";

        $uploads = [];
        foreach (is_array($body['uploads'] ?? null) ? $body['uploads'] : [] as $u) {
            $p = (string)($u['path'] ?? '');
            $sha = (string)($u['sha'] ?? '');
            if (!preg_match('#^' . preg_quote(UPLOAD_DIR, '#') . '/[0-9]{8}-[0-9]{6}-[0-9a-f]{8}\.webp$#', $p) || !preg_match('/^[0-9a-f]{40}$|^dry$/', $sha)) {
                fail('Invalid upload reference.');
            }
            $uploads[$p] = $sha;
        }

        // Uploaded photos that are no longer used get removed from the repo.
        $refs = referenced_images($content);
        $stale = [];
        foreach (list_uploads() as $file) {
            $web = '/images/uploads/' . $file;
            $repoPath = UPLOAD_DIR . '/' . $file;
            if (!isset($refs[$web]) && !isset($uploads[$repoPath])) {
                $stale[] = $repoPath;
            }
        }
        foreach ($uploads as $p => $_) {
            if (!isset($refs['/images/uploads/' . basename($p)])) {
                unset($uploads[$p]);
            }
        }

        if ($root = dry_root()) {
            file_put_contents("$root/" . CONTENT_PATH, $json);
            foreach ($stale as $p) {
                @unlink("$root/$p");
            }
            respond(['ok' => true, 'dryRun' => true]);
        }

        $changed = changed_sections(read_content(), $content);
        if (!$changed && !$uploads && !$stale) {
            respond(['ok' => true, 'unchanged' => true]);
        }

        // Flagged identity so admin-panel commits are easy to tell apart from human ones in `git log`.
        $who = [
            'name' => $config['commit_author_name'] ?? 'Samvel Admin Panel (automated)',
            'email' => $config['commit_author_email'] ?? 'admin-panel@samvelmheryan.am',
        ];
        $summary = $changed ? implode(', ', $changed) : 'photos';
        $message = "[admin-panel] Update $summary\n\n"
            . "Automated commit made through the /admin editor, not by a developer.\n"
            . ($uploads ? 'Photos added: ' . count($uploads) . "\n" : '')
            . ($stale ? 'Unused photos removed: ' . count($stale) . "\n" : '');

        $branch = $config['github_branch'];
        for ($attempt = 0; $attempt < 2; $attempt++) {
            $ref = github_ok(github('GET', '/git/ref/heads/' . rawurlencode($branch)), 'read branch');
            $headSha = $ref['object']['sha'];
            $commit = github_ok(github('GET', "/git/commits/$headSha"), 'read commit');

            $entries = [['path' => CONTENT_PATH, 'mode' => '100644', 'type' => 'blob', 'content' => $json]];
            foreach ($uploads as $p => $sha) {
                $entries[] = ['path' => $p, 'mode' => '100644', 'type' => 'blob', 'sha' => $sha];
            }
            foreach ($stale as $p) {
                $entries[] = ['path' => $p, 'mode' => '100644', 'type' => 'blob', 'sha' => null];
            }
            $tree = github_ok(github('POST', '/git/trees', ['base_tree' => $commit['tree']['sha'], 'tree' => $entries]), 'write tree');
            $when = gmdate('Y-m-d\TH:i:s\Z');
            $new = github_ok(github('POST', '/git/commits', [
                'message' => $message,
                'tree' => $tree['sha'],
                'parents' => [$headSha],
                'author' => $who + ['date' => $when],
                'committer' => $who + ['date' => $when],
            ]), 'write commit');
            $res = github('PATCH', '/git/refs/heads/' . rawurlencode($branch), ['sha' => $new['sha']]);
            if ($res['status'] === 422 && $attempt === 0) {
                continue; // branch moved underneath us; retry on the new head
            }
            github_ok($res, 'publish');
            respond(['ok' => true, 'commit' => $new['sha']]);
        }
        fail('Saving failed because the site was changed at the same time. Please try again.', 409);

    default:
        fail('Unknown action.', 404);
}
