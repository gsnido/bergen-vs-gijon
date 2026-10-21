# Bergen vs Gijón: a climate of rain

A static web dashboard that compares rainfall in **Bergen, Norway** and **Gijón, Spain** using 30 years of daily reanalysis data. A small Python script refreshes the data every night through cron.

What the dashboard shows:

- **Year in progress:** the cumulative number of rainy days (> 1 mm) so far this year in Bergen, plotted against Gijón's 30-year climate normal (median, 25–75th and 10–90th percentile bands). Bergen's own normal can be switched on as well.
- **Rainy days per year**, **total annual precipitation (mm)** and **longest streak of consecutive rainy days**, for every complete year since 1995.
- **How long the rain lasts:** the distribution of consecutive-rainy-day streak lengths, on a linear or log scale.

The frontend is plain HTML, CSS and JavaScript with Chart.js, and needs no build step. The updater uses only the Python 3 standard library: no pip, no virtualenv.

---

## Contents

- [How it works](#how-it-works)
- [Repository layout](#repository-layout)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Year rollover](#year-rollover)
- [Operations](#operations)
- [Troubleshooting](#troubleshooting)
- [Updating and uninstalling](#updating-and-uninstalling)
- [Data source and licence](#data-source-and-licence)

---

## How it works

```
cron (04:00, user climatedash)
  └─ /opt/bergen-vs-gijon/run.sh          lock + log + failure report
       └─ update_climate.py               fetch Open-Meteo, compute stats
            └─ /var/www/html/bergen-vs-gijon/climate.json   (atomic write)
                 └─ index.html + app.js   read climate.json in the browser
```

Each run downloads the complete history again (1995 to the last complete year) plus the current year up to yesterday. It then recomputes everything and replaces `climate.json`. The script keeps no state between runs, so there is no cache or database to reset.

The write is atomic. The script writes a temporary file (`.climate.XXXX.json.tmp`) in the same folder and then renames it over `climate.json`. Visitors never see a half-written file, and if a run fails, the previous `climate.json` stays in place.

---

## Repository layout

```
.
├── README.md
├── .gitignore                       # ignores the generated web/climate.json
├── web/                             # → /var/www/html/bergen-vs-gijon/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── scripts/                         # → /opt/bergen-vs-gijon/
│   ├── update_climate.py            # data fetcher / builder (stdlib only)
│   └── run.sh                       # cron wrapper: flock, logging, errors
└── deploy/
    ├── cron.d/bergen-vs-gijon       # → /etc/cron.d/bergen-vs-gijon
    ├── logrotate.d/bergen-vs-gijon  # → /etc/logrotate.d/bergen-vs-gijon
    └── webserver/
        ├── apache.conf              # example Apache snippet
        └── nginx.conf               # example nginx snippet
```

`climate.json` is generated data. It is git-ignored and created on the server by the first run.

---

## Requirements

- A Linux server (tested on Debian/Ubuntu) with `cron`, `flock` (from `util-linux`) and `python3` (3.8 or newer).
- A web server that can serve static files (Apache or nginx).
- Outbound HTTPS access to `archive-api.open-meteo.com`.
- Optional: a working mail transfer agent (for example `msmtp-mta` or `postfix`), if you want cron to email you when an update fails.

```bash
sudo apt update
sudo apt install python3 util-linux cron
```

---

## Installation

The commands below use these paths. To change them, see [Configuration](#configuration).

| What | Path |
|---|---|
| Website (static files and `climate.json`) | `/var/www/html/bergen-vs-gijon` |
| Updater scripts | `/opt/bergen-vs-gijon` |
| Log and lock file | `/var/log/bergen-vs-gijon` |
| Account that runs the job | `climatedash` |

### 1. Get the code

```bash
git clone https://github.com/<you>/bergen-vs-gijon.git
cd bergen-vs-gijon
```

### 2. Create a dedicated user for the job

The update runs as an unprivileged system account. It should not run as `www-data` (the web server user) or root. The web server only ever needs to read the site.

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin climatedash
```

> You can use your own login instead of `climatedash`. Substitute it everywhere below, including in the cron file.

### 3. Install the updater scripts (owned by root)

The scripts are owned by root, so the job can run them but cannot change them.

```bash
sudo install -d -o root -g root -m 755 /opt/bergen-vs-gijon
sudo install -o root -g root -m 755 scripts/update_climate.py scripts/run.sh /opt/bergen-vs-gijon/
```

### 4. Install the website (owned by the job user)

The job user must be able to write to the website folder, because the atomic write creates a temporary file there. Everyone else only needs read access.

```bash
sudo install -d -o climatedash -g climatedash -m 755 /var/www/html/bergen-vs-gijon
sudo install -o climatedash -g climatedash -m 644 web/index.html web/style.css web/app.js \
     /var/www/html/bergen-vs-gijon/
```

### 5. Create the log folder

```bash
sudo install -d -o climatedash -g climatedash -m 755 /var/log/bergen-vs-gijon
```

### 6. First run (creates `climate.json`)

```bash
sudo -u climatedash /opt/bergen-vs-gijon/run.sh; echo "exit=$?"
tail -n 3 /var/log/bergen-vs-gijon/update.log
ls -l /var/www/html/bergen-vs-gijon/climate.json
```

A successful run ends with a line like:

```
OK  wrote /var/www/html/bergen-vs-gijon/climate.json  year 2026 through 2026-10-20  normal 1996-2025  history to 2025  bergen_ytd_days=172  gijon_ytd_days=121
```

The first run takes a few seconds (four API requests, about 30 years of daily data per city).

### 7. Schedule the daily update

Edit `MAILTO` in `deploy/cron.d/bergen-vs-gijon` first, or set it to `""` to turn off email. Then install it:

```bash
sudo install -o root -g root -m 644 deploy/cron.d/bergen-vs-gijon /etc/cron.d/bergen-vs-gijon
```

Files in `/etc/cron.d/` must be owned by root, must not be group- or world-writable, must end with a newline, and must have a user column. The provided file meets all of these. Cron picks up the file automatically; there's nothing to restart.

The job runs at 04:00 server time. Open-Meteo usually has the previous day's data by then.

### 8. Rotate the log (optional)

```bash
sudo install -o root -g root -m 644 deploy/logrotate.d/bergen-vs-gijon /etc/logrotate.d/bergen-vs-gijon
sudo logrotate --debug /etc/logrotate.d/bergen-vs-gijon   # dry run
```

### 9. Configure the web server

If your document root is `/var/www/html`, the site already works at `https://your-domain/bergen-vs-gijon/`. The snippets in `deploy/webserver/` add two things: no directory listings, and a `Cache-Control: no-cache` header on `climate.json`. That header stops browsers or proxies from showing yesterday's data.

Apache:

```bash
sudo cp deploy/webserver/apache.conf /etc/apache2/conf-available/bergen-vs-gijon.conf
sudo a2enmod headers
sudo a2enconf bergen-vs-gijon
sudo apachectl configtest && sudo systemctl reload apache2
```

nginx: paste the contents of `deploy/webserver/nginx.conf` into your `server { … }` block, then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 10. Verify

```bash
curl -sI https://your-domain/bergen-vs-gijon/climate.json | grep -i -E "^HTTP|cache-control|last-modified"
```

Open the page and check the date line under the headline (for example "2026 YTD through …"). It should show yesterday's date.

### Final permissions

```
/opt/bergen-vs-gijon/                  root:root          755
/opt/bergen-vs-gijon/*.py, *.sh        root:root          755
/var/www/html/bergen-vs-gijon/         climatedash:climatedash  755
/var/www/html/bergen-vs-gijon/*        climatedash:climatedash  644
/var/log/bergen-vs-gijon/              climatedash:climatedash  755
/etc/cron.d/bergen-vs-gijon            root:root          644
```

---

## Configuration

### Paths

`run.sh` reads three environment variables, each with a default:

| Variable | Default | Meaning |
|---|---|---|
| `APP_DIR` | `/opt/bergen-vs-gijon` | Location of `update_climate.py` |
| `WEBROOT` | `/var/www/html/bergen-vs-gijon` | `climate.json` is written here |
| `LOGDIR` | `/var/log/bergen-vs-gijon` | `update.log` and `update.lock` |

To use other paths, set the variables on the cron line. Then adjust ownership as in the installation steps.

```
0 4 * * * climatedash WEBROOT=/srv/www/rain /opt/bergen-vs-gijon/run.sh
```

`update_climate.py` uses `CLIMATE_DASH_OUTPUT` as its output file; `run.sh` sets it from `WEBROOT`. If the variable is not set, the script falls back to the `OUTPUT_PATH` default at the top of the file.

### Analysis settings

These are at the top of `scripts/update_climate.py`:

| Setting | Default | Meaning |
|---|---|---|
| `HIST_START` | `1995-01-01` | First day of the history |
| `RAIN_THRESHOLD` | `1.0` | A day is "rainy" if precipitation > this many mm |
| `NORMAL_LENGTH` | `30` | Length of the rolling climate normal, in years |
| `NORMAL_FIXED` | `None` | Set to e.g. `(1991, 2020)` to freeze the normal period |
| `CITIES` | Bergen, Gijón | Coordinates, time zone and display name |

To compare Bergen with a different city, change the `gijon` entry in `CITIES` (`lat`, `lon`, `tz`, `name`). The key `gijon` is also used in `app.js`, `index.html` and `style.css` (`--color-gijon`, `.gijon-text`, `data-city="gijon"`). Keep the key and change only the labels, or rename it consistently in all four files.

### Switching the main panel back to millimetres

`climate.json` contains both views:

- `ytd_days` / `normals_days`: cumulative rainy days (used by default)
- `ytd_mm` / `normals_mm`: cumulative precipitation in mm

In `app.js`, replace `DATA.ytd_days` and `DATA.normals_days` with `DATA.ytd_mm` and `DATA.normals_mm`. Then update the y-axis label and caption text.

---

## Year rollover

No action is needed at New Year. All dates are worked out from yesterday, the last day with data:

| Run date | Main panel | Annual charts up to | Climate normal |
|---|---|---|---|
| 2026-10-20 | 2026 | 2025 | 1996–2025 |
| 2027-01-01 | 2026 (complete year) | 2025 | 1996–2025 |
| 2027-01-02 | 2027 | 2026 | 1997–2026 |

On 1 January the dashboard shows the complete previous year, including 31 December. From 2 January it starts the new year at zero, and the year just finished joins the annual charts and the rolling normal.

To rehearse a run as if it were another day, and write the result somewhere harmless:

```bash
sudo -u climatedash CLIMATE_DASH_TODAY=2026-12-15 CLIMATE_DASH_OUTPUT=/tmp/test.json \
     /usr/bin/python3 /opt/bergen-vs-gijon/update_climate.py
```

`CLIMATE_DASH_TODAY` must be today or earlier; Open-Meteo rejects date ranges in the future.

---

## Operations

### Check that it is running

```bash
tail -n 20 /var/log/bergen-vs-gijon/update.log          # START / OK / DONE every day
ls -l --time-style=long-iso /var/www/html/bergen-vs-gijon/climate.json
python3 -c "import json;m=json.load(open('/var/www/html/bergen-vs-gijon/climate.json'))['meta'];print(m['generated_at'],m['ytd_through'])"
systemctl is-active cron
sudo journalctl -u cron --since yesterday | grep bergen-vs-gijon
```

### Run an update by hand

```bash
sudo -u climatedash /opt/bergen-vs-gijon/run.sh
```

### Log format

```
----
2026-10-21T04:00:01+02:00  START
OK  wrote /var/www/html/bergen-vs-gijon/climate.json  year 2026 through 2026-10-20  ...
2026-10-21T04:00:05+02:00  DONE
```

A failed run ends with `FAIL exit=N` after the error message. `run.sh` also prints a short report to stderr. Cron mails that report to `MAILTO` if the server can send mail. Successful runs are silent.

Exit codes of `update_climate.py`:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Other error (permissions, bad data, …) |
| 2 | Network or HTTP error talking to Open-Meteo |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Permission denied: '/var/www/html/bergen-vs-gijon/.climate.XXXX.json.tmp'` | The job user cannot write to the website folder | `sudo chown climatedash:climatedash /var/www/html/bergen-vs-gijon` |
| `run.sh: line N: /var/log/.../update.lock: Permission denied` | Log folder missing or owned by someone else | `sudo install -d -o climatedash -g climatedash -m 755 /var/log/bergen-vs-gijon` |
| Log shows `OK wrote …` daily, but the page doesn't change | The script writes to a different path than the site is served from, or a cache serves an old copy | Check the path in the `OK wrote` line; hard-refresh (Ctrl+Shift+R); add the `no-cache` header (step 9); purge any CDN |
| Nothing in the log at all | Cron isn't running the job | `systemctl is-active cron`; check that `/etc/cron.d/bergen-vs-gijon` is root:root 644 and ends with a newline; `sudo journalctl -u cron` |
| `SKIP another run already in progress` | An earlier run is still running or stuck | `ps aux \| grep update_climate`; this is harmless if it happens once |
| `NETWORK ERROR: HTTP Error 400: Bad Request` | The requested date range is invalid (for example `CLIMATE_DASH_TODAY` in the future) | Check the dates; normal runs compute valid ranges |
| `NETWORK ERROR: HTTP Error 429` / `502` / `504` / timeouts | Open-Meteo rate limit or outage | Usually temporary; the old `climate.json` stays online and the next night's run catches up |
| `journalctl` shows "You are currently not seeing messages from other users" | Your login isn't in the `adm` / `systemd-journal` group | Use `sudo journalctl …` |
| Page loads but charts are empty | `climate.json` missing or not readable | `ls -l` should show mode 644; open `/bergen-vs-gijon/climate.json` in the browser |

---

## Updating and uninstalling

### Deploy a new version

```bash
cd bergen-vs-gijon && git pull
sudo install -o root -g root -m 755 scripts/update_climate.py scripts/run.sh /opt/bergen-vs-gijon/
sudo install -o climatedash -g climatedash -m 644 web/index.html web/style.css web/app.js \
     /var/www/html/bergen-vs-gijon/
sudo -u climatedash /opt/bergen-vs-gijon/run.sh   # regenerate climate.json with the new code
```

### Uninstall

```bash
sudo rm -f /etc/cron.d/bergen-vs-gijon /etc/logrotate.d/bergen-vs-gijon
sudo a2disconf bergen-vs-gijon 2>/dev/null; sudo rm -f /etc/apache2/conf-available/bergen-vs-gijon.conf
sudo rm -rf /opt/bergen-vs-gijon /var/www/html/bergen-vs-gijon /var/log/bergen-vs-gijon
sudo userdel climatedash
```

---

## Data source and licence

- **Data:** daily `precipitation_sum` from the [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) (ERA5 / ECMWF reanalysis).
- **Locations:** Bergen 60.39° N, 5.32° E (Europe/Oslo); Gijón 43.53° N, 5.66° W (Europe/Madrid). Reanalysis values are grid-cell averages and can differ from a nearby rain gauge.
- **Terms:** the free Open-Meteo API is for non-commercial use only, with limits of fewer than 10,000 calls per day, 5,000 per hour and 600 per minute. Data are licensed under CC BY 4.0 ([Open-Meteo terms](https://open-meteo.com/en/terms)). This dashboard makes 4 calls per day. Keep the Open-Meteo attribution on the page.
- **Code licence:** add a `LICENSE` file of your choice (for example MIT) before publishing.
