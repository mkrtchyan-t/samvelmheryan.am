<?php
/**
 * Set (or change) the admin login password in a samvel-admin-config.php file.
 *
 *   php scripts/set-admin-password.php .admin-secrets/samvel-admin-config.php
 *
 * The password is typed hidden (not echoed, not stored in shell history) and only its hash
 * is written to the config file. Afterwards upload the file to the server again.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit(1);
}

$path = $argv[1] ?? '';
if ($path === '' || !is_file($path)) {
    fwrite(STDERR, "Usage: php scripts/set-admin-password.php path/to/samvel-admin-config.php\n");
    exit(1);
}
$src = (string)file_get_contents($path);
if (!preg_match("/'password_hash'\s*=>\s*'[^']*'/", $src)) {
    fwrite(STDERR, "Could not find the 'password_hash' line in $path\n");
    exit(1);
}

function ask(string $prompt): string
{
    $tty = function_exists('posix_isatty') && posix_isatty(STDIN);
    fwrite(STDERR, $prompt);
    if ($tty) {
        shell_exec('stty -echo');
    }
    $line = fgets(STDIN);
    if ($tty) {
        shell_exec('stty echo');
        fwrite(STDERR, "\n");
    }
    return rtrim((string)$line, "\r\n");
}

$one = ask('New password (min 10 characters): ');
if (mb_strlen($one) < 10) {
    fwrite(STDERR, "Too short. Nothing changed.\n");
    exit(1);
}
$two = ask('Repeat password: ');
if (!hash_equals($one, $two)) {
    fwrite(STDERR, "Passwords do not match. Nothing changed.\n");
    exit(1);
}

$hash = password_hash($one, PASSWORD_DEFAULT);
$new = preg_replace_callback("/'password_hash'\s*=>\s*'[^']*'/", static fn() => "'password_hash' => '$hash'", $src, 1);
$tmp = $path . '.tmp';
file_put_contents($tmp, $new);
chmod($tmp, 0600);
rename($tmp, $path);
fwrite(STDERR, "Done. Password updated in $path\nNow upload that file to the server (above public_html).\n");
