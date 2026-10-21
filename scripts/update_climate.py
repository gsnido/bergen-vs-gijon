#!/usr/bin/env python3
"""Fetch fresh Open-Meteo data and rewrite climate.json for the dashboard.
Designed to run unattended via cron. Atomic write, std-lib only.

v2: Compares Bergen vs Gijón. Main panel uses CUMULATIVE RAINY DAYS
(days with > RAIN_THRESHOLD mm) instead of cumulative mm.

v3: Year rollover is automatic. The "current year" is the year of
*yesterday* (the last day with data), so on 1 January the dashboard keeps
showing the complete previous year; from 2 January it starts the new one.
History and the climate normal extend themselves every year.
"""
import json
import os
import sys
import tempfile
import urllib.request
import urllib.parse
import urllib.error
from collections import defaultdict
from datetime import date, timedelta

# ---------- CONFIG ----------
OUTPUT_PATH = os.environ.get("CLIMATE_DASH_OUTPUT",
                             "/var/www/html/bergen-vs-gijon/climate.json")
HIST_START  = "1995-01-01"
RAIN_THRESHOLD = 1.0   # mm

CITIES = {
    "bergen": {"lat": 60.39,   "lon":  5.32,   "tz": "Europe/Oslo",   "name": "Bergen, Norway"},
    "gijon":  {"lat": 43.5322, "lon": -5.6611, "tz": "Europe/Madrid", "name": "Gijón, Spain"},
}
# Climate normal = the NORMAL_LENGTH complete years before the current year.
# Set NORMAL_FIXED = (1995, 2024) to freeze it instead of rolling.
NORMAL_LENGTH = 30
NORMAL_FIXED  = None
TIMEOUT = 60
# ----------------------------


def periods(today):
    """Work out every date window from 'today'."""
    ytd_end = today - timedelta(days=1)          # last day with data
    year = ytd_end.year                          # year shown in the main panel
    hist_end = date(year - 1, 12, 31)            # last complete year
    if NORMAL_FIXED:
        normal_years = list(range(NORMAL_FIXED[0], NORMAL_FIXED[1] + 1))
    else:
        first = max(int(HIST_START[:4]), year - NORMAL_LENGTH)
        normal_years = list(range(first, year))
    return year, ytd_end.isoformat(), hist_end.isoformat(), normal_years


def fetch(lat, lon, tz, start, end):
    url = (
        "https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={lat}&longitude={lon}"
        f"&start_date={start}&end_date={end}"
        f"&daily=precipitation_sum&timezone={urllib.parse.quote(tz)}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "bergen-vs-gijon/1.2 (+https://github.com/)"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        d = json.load(r)
    return list(zip(d["daily"]["time"], d["daily"]["precipitation_sum"]))


def is_rainy(p):
    return p is not None and p > RAIN_THRESHOLD


def annual_stats(rows):
    by_year = defaultdict(list)
    for d, p in rows:
        by_year[int(d[:4])].append((d, p if p is not None else 0.0))
    out = {}
    for y, days in by_year.items():
        days.sort()
        rainy = sum(1 for _, p in days if is_rainy(p))
        total = sum(p for _, p in days if p is not None)
        streaks, cur = [], 0
        for _, p in days:
            if is_rainy(p):
                cur += 1
            else:
                if cur:
                    streaks.append(cur)
                cur = 0
        if cur:
            streaks.append(cur)
        hist = defaultdict(int)
        for s in streaks:
            hist[s] += 1
        out[y] = {
            "rainy_days":   rainy,
            "total_mm":     round(total, 1),
            "max_consec":   max(streaks) if streaks else 0,
            "mean_streak":  round(sum(streaks) / len(streaks), 2) if streaks else 0,
            "streak_hist":  dict(hist),
            "days_in_year": len(days),
        }
    return out


def cumulative_by_doy(rows, value_fn):
    """Generic cumulative-by-day-of-year builder.
    value_fn(p) returns the value to add for that day (e.g. p mm, or 1 if rainy)."""
    by_year = defaultdict(dict)
    for d, p in rows:
        y, m, dd = int(d[:4]), int(d[5:7]), int(d[8:10])
        doy = (date(y, m, dd) - date(y, 1, 1)).days + 1
        by_year[y][doy] = value_fn(p)
    out = {}
    for y, mp in by_year.items():
        max_doy = max(mp)
        arr, cum = [], 0.0
        for doy in range(1, max_doy + 1):
            cum += mp.get(doy, 0.0)
            arr.append(round(cum, 2))
        out[y] = arr
    return out


def climatology(cum_by_year, years, n_days=366):
    per_doy = [[] for _ in range(n_days)]
    for y in years:
        if y not in cum_by_year:
            continue
        for i, v in enumerate(cum_by_year[y]):
            if i < n_days:
                per_doy[i].append(v)

    def pct(vals, p):
        s = sorted(vals)
        k = (len(s) - 1) * p
        f = int(k); c = min(f + 1, len(s) - 1)
        return s[f] if f == c else s[f] + (s[c] - s[f]) * (k - f)

    out = {k: [] for k in ("mean", "p10", "p25", "p50", "p75", "p90")}
    for vals in per_doy:
        if vals:
            out["mean"].append(round(sum(vals) / len(vals), 2))
            for k, p in (("p10", .10), ("p25", .25), ("p50", .50), ("p75", .75), ("p90", .90)):
                out[k].append(round(pct(vals, p), 2))
        else:
            for k in out:
                out[k].append(None)
    return out


def summarize(annual):
    full = [y for y, v in annual.items() if v["days_in_year"] >= 365]
    rd = [annual[y]["rainy_days"] for y in full]
    tm = [annual[y]["total_mm"]   for y in full]
    mc = [annual[y]["max_consec"] for y in full]
    return {
        "years_covered":  [min(full), max(full)],
        "n_years":        len(full),
        "avg_rainy_days": round(sum(rd) / len(rd), 1),
        "min_rainy_days": min(rd),
        "max_rainy_days": max(rd),
        "avg_total_mm":   round(sum(tm) / len(tm), 1),
        "min_total_mm":   round(min(tm), 1),
        "max_total_mm":   round(max(tm), 1),
        "avg_max_consec": round(sum(mc) / len(mc), 1),
        "abs_max_consec": max(mc),
    }


def agg_streak_dist(annual, years):
    agg = defaultdict(int)
    for y in years:
        if y in annual:
            for k, v in annual[y]["streak_hist"].items():
                agg[int(k)] += v
    return dict(sorted(agg.items()))


def atomic_write(path, data):
    d = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(prefix=".climate.", suffix=".json.tmp", dir=d)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, separators=(",", ":"))
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def main():
    # CLIMATE_DASH_TODAY=2027-01-01 lets you rehearse a rollover by hand.
    today = date.fromisoformat(os.environ.get("CLIMATE_DASH_TODAY", date.today().isoformat()))
    CURRENT_YEAR, ytd_end, HIST_END, NORMAL_YEARS = periods(today)

    hist = {c: fetch(v["lat"], v["lon"], v["tz"], HIST_START, HIST_END)              for c, v in CITIES.items()}
    ytd  = {c: fetch(v["lat"], v["lon"], v["tz"], f"{CURRENT_YEAR}-01-01", ytd_end) for c, v in CITIES.items()}

    annual = {c: annual_stats(hist[c]) for c in CITIES}

    # Two parallel cumulative series — mm and rainy-day count
    cum_mm   = {c: cumulative_by_doy(hist[c], lambda p: p if p is not None else 0.0) for c in CITIES}
    cum_days = {c: cumulative_by_doy(hist[c], lambda p: 1.0 if is_rainy(p) else 0.0) for c in CITIES}

    normals_mm   = {c: climatology(cum_mm[c],   NORMAL_YEARS) for c in CITIES}
    normals_days = {c: climatology(cum_days[c], NORMAL_YEARS) for c in CITIES}

    ytd_cum_mm   = {c: cumulative_by_doy(ytd[c], lambda p: p if p is not None else 0.0).get(CURRENT_YEAR, []) for c in CITIES}
    ytd_cum_days = {c: cumulative_by_doy(ytd[c], lambda p: 1.0 if is_rainy(p) else 0.0).get(CURRENT_YEAR, []) for c in CITIES}

    summary = {c: summarize(annual[c]) for c in CITIES}
    streaks = {c: agg_streak_dist(annual[c], NORMAL_YEARS) for c in CITIES}

    years_full = sorted(
        y for y in (set(annual["bergen"]) & set(annual["gijon"]))
        if annual["bergen"][y]["days_in_year"] >= 365
        and annual["gijon"][y]["days_in_year"]  >= 365
    )

    output = {
        "meta": {
            "rain_threshold_mm": RAIN_THRESHOLD,
            "source": "Open-Meteo Archive API (ERA5)",
            "bergen": {"lat": CITIES["bergen"]["lat"], "lon": CITIES["bergen"]["lon"], "name": CITIES["bergen"]["name"]},
            "gijon":  {"lat": CITIES["gijon"]["lat"],  "lon": CITIES["gijon"]["lon"],  "name": CITIES["gijon"]["name"]},
            "normal_window": [NORMAL_YEARS[0], NORMAL_YEARS[-1]],
            "hist_window":   [int(HIST_START[:4]), int(HIST_END[:4])],
            "ytd_through":   ytd_end,
            "generated_at":  date.today().isoformat(),
            "current_year":  CURRENT_YEAR,
        },
        "summary": summary,
        "annual": {
            "years":  years_full,
            "bergen": {k: [annual["bergen"][y][k] for y in years_full] for k in ("rainy_days", "total_mm", "max_consec", "mean_streak")},
            "gijon":  {k: [annual["gijon"][y][k]  for y in years_full] for k in ("rainy_days", "total_mm", "max_consec", "mean_streak")},
        },
        "streak_dist": streaks,
        # Two parallel views — frontend chooses which to render
        "normals_mm":   normals_mm,
        "normals_days": normals_days,
        "ytd_mm":       ytd_cum_mm,
        "ytd_days":     ytd_cum_days,
        "ytd_daily": {
            "bergen": [p for _, p in ytd["bergen"]],
            "gijon":  [p for _, p in ytd["gijon"]],
            "dates":  [d for d, _ in ytd["bergen"]],
        },
    }

    atomic_write(OUTPUT_PATH, output)
    print(f"OK  wrote {OUTPUT_PATH}  year {CURRENT_YEAR} through {ytd_end}  "
          f"normal {NORMAL_YEARS[0]}-{NORMAL_YEARS[-1]}  history to {HIST_END[:4]}  "
          f"bergen_ytd_days={int(ytd_cum_days['bergen'][-1]) if ytd_cum_days['bergen'] else 0}  "
          f"gijon_ytd_days={int(ytd_cum_days['gijon'][-1]) if ytd_cum_days['gijon'] else 0}")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as e:
        print(f"NETWORK ERROR: {e}", file=sys.stderr)
        sys.exit(2)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
