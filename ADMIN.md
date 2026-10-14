# Admin panel

`/admin` lets Samvel edit the biography text, banners, books, films (including each one's own detail page), gallery
and contact info without touching code.

**How it works:** the page content lives in `content/site.json`. The admin page (`public/admin/`) talks to
`public/admin/api.php`, which checks a username/password, then commits changes to GitHub using a token that
only exists in a config file on the server. The existing GitHub Actions workflow then rebuilds and deploys
(about 2–3 minutes). Photos are converted to WebP in the browser before upload and stored in
`public/images/uploads/`. Unused uploaded photos are removed automatically on the next save.

**Detail pages:** every book/film card has a "has its own page" checkbox. When ticked, `src/pages/[slug].astro`
generates `/<slug>` from the card's `detail` block (subtitle, details line, paragraphs, YouTube video, photo
sections). Page addresses of existing items are kept; new items get a generated address (`book-…` / `film-…`).
Never rename or hand-edit slugs in `content/site.json` without updating links that point to them.

**Banner links:** each banner can optionally link to one of the site's book/film pages, a home-page section, the
gallery page, or any `https://` address (opens in a new tab). Empty = not clickable.

**Languages:** the site and admin are Armenian-only for now. `content/site.json` still stores `en`/`ru` text next to
every Armenian string and the admin preserves it on save, so enabling the language switcher later only needs the
`admin-panel-i18n` branch (switcher + EN/RU boxes in the admin).

**Commit identity:** admin saves are committed to the branch named in the config (`master` = production) with the
author/committer `Samvel Admin Panel (automated) <admin-panel@samvelmheryan.am>` and a message starting with
`[admin-panel] Update <sections>`, so they are easy to tell apart from developer commits
(e.g. `git log --author="Admin Panel"` or `git log --grep="^\[admin-panel\]"`). Override with `commit_author_name` /
`commit_author_email` in the config. A save that changes nothing creates no commit.

## Fixed image shapes

Every image spot has a fixed shape. The admin page center-crops each upload to it, shrinks it to a sensible size
(never enlarges) and converts it to WebP, and `api.php` re-checks the real pixel size/shape of every upload, so a wrong
file is rejected even if the page is bypassed. The table lives in two places that must stay in sync:
`IMAGE_KINDS` in `public/admin/admin.js` and in `public/admin/api.php`.

| Where | Shape | Max size (px) |
|---|---|---|
| Banners | 4:1 strip | 1920 × 480 |
| Book / film covers | 5:8 portrait | 800 × 1280 |
| Film poster (detail page) | 1:1 square | 900 × 900 |
| Author photo | 2:3 portrait | 800 × 1200 |
| Book page/excerpt photos | 3:4 portrait | 900 × 1200 |
| Gallery and film event photos | 3:2 landscape or 2:3 portrait (nearest to the photo) | 1600 long side |
| Film wide image | any shape, not cropped | 1600 wide |

Photos already on the site are not touched; only new uploads are cropped.

## One-time server setup

1. **Create a GitHub token** (GitHub → Settings → Developer settings → Fine-grained tokens):
   repository access = *only this repo*; permission *Contents: Read and write*; nothing else.
2. **Create the password hash** on any machine with PHP:
   `php -r "echo password_hash('CHOOSE-A-PASSWORD', PASSWORD_DEFAULT), PHP_EOL;"`
3. **Create the config file** from `admin-config.sample.php` as
   `/home/samvelmheryan/samvel-admin-config.php` — one level *above* `public_html/`, so it is never web-accessible.
   Fill in username, password hash, token, repo (`owner/name`) and branch (`master` for production).
   Optionally `chmod 600` it.
4. Deploy (push to `master`) and open `https://samvelmheryan.am/admin/`.

Staging (`/home/samvelmheryan/staging/`) reads the same config file one level up, so it would also commit to
that branch. To test against a different branch, set the `SAMVEL_ADMIN_CONFIG` environment variable to another file.

## Changing the password

```bash
php scripts/set-admin-password.php .admin-secrets/samvel-admin-config.php
```

Type the new password twice (hidden). Only its hash is written to the file; then upload the file to the server again
(above `public_html/`). Delete `.admin-secrets/PASSWORD-for-uncle.txt` afterwards, it holds the old password.

## Rotating the token / password

Edit the config file on the server; nothing in the repo changes. To revoke access instantly, delete the token on GitHub.

## Local testing without GitHub

Set `'dry_run_root' => '/path/to/this/repo'` in the config and run `php -S localhost:8000 -t public`.
Saves are then written to the local working tree instead of GitHub.
