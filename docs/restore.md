# Restoring a backup

How to bring an Instance back from its off-site backups (#33) onto any machine with Docker: the old server died, was stolen, or you are moving to new hardware. Allow half an hour. This procedure was last tested on 28/10/2026 by restoring a backup into a fresh Compose stack; the automated test `tests/functional/backups.spec.ts` ("Backup restore") repeats its decrypt and restore steps on every CI run.

## What you need

- **The backup passphrase**, the one the Superuser set in Instance settings and keeps offline. Without it the backups can't be decrypted; nobody, including the server, can recover it.
- **The bucket's details and keys**: endpoint, bucket, region, access key and secret key (from the storage provider's console if the server is gone).
- A machine with Docker and Docker Compose, and this repository's `compose.yaml` (or the one shipped with the release).
- **The old server's `APP_KEY`** (from its `.env`), kept offline next to the passphrase. It isn't in the backups. Without it the restore still works, but the secrets stored in Instance settings must be entered again (step 5).

## What a backup is

Every night the `backup` service uploads two objects with the same UTC timestamp:

| Object                                 | What it is                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `maso-backup-20261028T003000Z.tar.age` | The archive, encrypted with [age](https://age-encryption.org): `database.dump` and `storage/` |
| `maso-backup-20261028T003000Z.key.age` | The age key file that decrypts it, itself encrypted with the passphrase                       |

`database.dump` is a `pg_dump` in custom format; `storage/` holds the uploaded files (company logo, Item Documents, Visit photos, Issued Document PDFs). The server only keeps the public half of the key, so it can make backups but can't read them. Older backups beyond the retention count set in Instance settings are deleted.

A changed passphrase applies from the next backup: each backup opens with the passphrase in force when it was taken.

## 1. Download the latest backup

List the bucket and download the newest pair, here with the AWS CLI in a container (any S3 tool will do):

```sh
mkdir maso-restore && cd maso-restore
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=…
s3() {
  docker run --rm -v "$PWD":/w -w /w -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
    amazon/aws-cli --endpoint-url https://s3.fr-par.scw.cloud --region fr-par s3 "$@"
}
s3 ls s3://maso-backup/
s3 cp s3://maso-backup/maso-backup-20261028T003000Z.tar.age .
s3 cp s3://maso-backup/maso-backup-20261028T003000Z.key.age .
```

## 2. Decrypt it

With `age` installed (`apt install age`, `brew install age`), or in a container:

```sh
docker run --rm -it -v "$PWD":/w -w /w alpine:3.22 sh -c 'apk add -q age &&
  age -d -i maso-backup-20261028T003000Z.key.age -o backup.tar maso-backup-20261028T003000Z.tar.age'
```

age asks for the passphrase (`Enter passphrase for identity file …`). A wrong passphrase stops here with an error; the archive is untouched.

## 3. Unpack it

```sh
mkdir backup && tar -xf backup.tar -C backup
ls backup        # database.dump  storage
```

`backup.tar` and `backup/` are **not encrypted**: delete them when you are done (step 8).

## 4. Start an empty database

In the directory with `compose.yaml` and a `.env` (copy `.env.example`), start **only** the database, so the app doesn't create an empty schema first:

```sh
docker compose up -d db
docker compose ps db     # wait for "healthy"
```

## 5. Restore the database

```sh
docker compose exec -T db pg_restore --no-owner --no-privileges --exit-on-error \
  -U maso -d maso < /path/to/maso-restore/backup/database.dump
```

Secrets stored in Instance settings (the Openapi token, the webhook secret, the bucket's secret key) are encrypted with `APP_KEY`. Put the old `APP_KEY` in `.env` to keep them. With a new one (`openssl rand -base64 32`) they read as missing, and the Superuser enters them again in step 7. Everything else, including the backup key and passphrase, is unaffected.

## 6. Restore the files and start the app

```sh
docker compose run --rm --no-deps -v /path/to/maso-restore/backup/storage:/restore:ro \
  --entrypoint sh app -c 'cp -a /restore/. /app/storage/'
docker compose up -d app
```

This starts the app and what it needs (`db`, `gotenberg`), but **not** the `backup` and `sdi` services. The restored settings still point at the old server's bucket. Started now, `backup` would catch up on the missed night: it would upload to that bucket and prune its oldest backups while the old server may still be writing there, or while this is only a drill. The `sdi` poller (ADR 0019) would use the restored Openapi token, which works in production. Both start in step 7.

**On a drill, before anyone uses the app:** in Instance settings set the SDI mode to "Manuale", or remove the Openapi token. The restored app holds a working production token. Sending an Invoice from the drill would send it to SDI for real.

Use the same release as the old server, or a newer one: the app runs any newer migrations on start-up.

## 7. Check, then turn the backups back on

- Sign in as the Admin; open a few recent Jobs, an Invoice and its PDF, a Visit with photos.
- Sign in as the Superuser; in Instance settings re-enter any secret that now reads as missing (step 5).
- Don't press "Esegui ora" yet. It uploads and prunes too.
- Before any backup from this machine, one of these must hold:
  - **Real recovery**: the old server is off for good, so only this machine writes to the bucket.
  - **Drill** (the old server keeps running): point Instance settings at a different bucket first, so the drill never prunes the real backups.
- Then start the backup job and take a backup:

  ```sh
  docker compose up -d backup
  ```

  Press "Esegui ora" and check the backup succeeds.

- **SDI poller:** on a real recovery only, once the old server is off for good, start it:

  ```sh
  docker compose up -d sdi
  ```

  Never on a drill: two servers would poll and send through the same Openapi account.

- A later `docker compose up -d` (for example when updating, #34) starts **every** service, `backup` and `sdi` included. On a drill machine, stop or remove it first.

## 8. Clean up

```sh
rm -rf /path/to/maso-restore/backup /path/to/maso-restore/backup.tar
```

Keep the downloaded `.age` files only if you want them; they are encrypted.
