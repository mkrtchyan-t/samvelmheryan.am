<?php
/**
 * Server-side config for the admin panel (public/admin/api.php).
 *
 * Copy this file to the folder ABOVE the website's web root, e.g.
 *   /home/samvelmheryan/samvel-admin-config.php      (web root = public_html/)
 * and fill it in. NEVER commit the real file and never put it inside public_html.
 *
 * Create the password hash with:   php -r "echo password_hash('the-password', PASSWORD_DEFAULT), PHP_EOL;"
 *
 * Create the token at GitHub → Settings → Developer settings → Fine-grained tokens:
 *   - Repository access: ONLY this repository
 *   - Permissions: Contents → Read and write (nothing else)
 */
return [
    'username' => 'samvel',
    'password_hash' => '$2y$10$REPLACE_WITH_OUTPUT_OF_password_hash',

    'github_token' => 'github_pat_REPLACE_ME',
    'github_repo' => 'OWNER/REPO',
    'github_branch' => 'master',   // master = production deploy

    // Local testing only: write to a local checkout instead of GitHub.
    // 'dry_run_root' => '/path/to/samvelmheryan.am',
];
