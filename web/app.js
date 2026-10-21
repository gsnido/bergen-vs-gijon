/* Bergen vs Gijón climate dashboard — Chart.js renderer */
(() => {

  // -------- Theme toggle --------
  const root = document.documentElement;
  const themeBtn = document.querySelector('[data-theme-toggle]');
  let mode = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  root.setAttribute('data-theme', mode);
  const setIcon = () => {
    themeBtn.innerHTML = mode === 'dark'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  };
  setIcon();
  themeBtn.addEventListener('click', () => {
    mode = mode === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', mode);
    setIcon();
    rerenderAll();
  });

  // -------- Color helpers --------
  const cssVar = (name) => getComputedStyle(root).getPropertyValue(name).trim();
  const palette = () => ({
    bergen:      cssVar('--color-bergen')       || '#2dbdc8',
    bergenSoft:  cssVar('--color-bergen-soft')  || 'rgba(45,189,200,0.22)',
    bergenBand:  cssVar('--color-bergen-band')  || 'rgba(45,189,200,0.16)',
    gijon:       cssVar('--color-gijon')        || '#e85d75',
    gijonSoft:   cssVar('--color-gijon-soft')   || 'rgba(232,93,117,0.20)',
    gijonBand:   cssVar('--color-gijon-band')   || 'rgba(232,93,117,0.14)',
    text:    cssVar('--color-text')       || '#e6ecf2',
    muted:   cssVar('--color-text-muted') || '#8a9aae',
    faint:   cssVar('--color-text-faint') || '#5a6a7e',
    grid:    cssVar('--grid-line')        || 'rgba(255,255,255,0.06)',
    surface: cssVar('--color-surface')    || '#131b23',
    border:  cssVar('--color-border')     || '#283649',
  });

  // -------- Chart.js defaults --------
  Chart.defaults.font.family = "'Satoshi','Helvetica Neue',system-ui,sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.animation.duration = 500;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.responsive = true;

  // Month-tick positions on day-of-year axis (non-leap)
  const MONTH_DOYS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
  const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const fmt = (n, d=0) => {
    if (n == null) return '—';
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  };

  function doyToDateLabel(doy) {
    const d = new Date(2024, 0, 1);
    d.setDate(doy);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // -------- Load data --------
  let DATA;
  let charts = {};
  let streakScale = 'linear';
  let showBergenBand = false;
  let showGijon2026  = true;

  fetch('climate.json').then(r => r.json()).then(d => {
    DATA = d;
    init();
  }).catch(err => {
    document.getElementById('meta-line').textContent = 'Failed to load climate data: ' + err.message;
  });

  function init() {
    const b = DATA.summary.bergen, g = DATA.summary.gijon;
    document.getElementById('kpi-bergen-rd').textContent     = fmt(b.avg_rainy_days, 1);
    document.getElementById('kpi-bergen-mm').textContent     = fmt(b.avg_total_mm, 0);
    document.getElementById('kpi-bergen-streak').textContent = b.abs_max_consec + 'd';
    document.getElementById('kpi-gijon-rd').textContent      = fmt(g.avg_rainy_days, 1);
    document.getElementById('kpi-gijon-mm').textContent      = fmt(g.avg_total_mm, 0);
    document.getElementById('kpi-gijon-streak').textContent  = g.abs_max_consec + 'd';

    const meta = DATA.meta;
    const ytdDate = new Date(meta.ytd_through + 'T00:00:00');
    const ytdLabel = ytdDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    document.getElementById('meta-line').textContent =
      `${meta.normal_window[0]}–${meta.normal_window[1]} normal • ${meta.current_year} YTD through ${ytdLabel} • >${meta.rain_threshold_mm} mm threshold`;
    document.getElementById('meta-ytd').textContent = ytdLabel;

    document.getElementById('show-bergen-band').addEventListener('change', (e) => {
      showBergenBand = e.target.checked;
      renderYTD();
    });
    document.getElementById('show-gijon-2026').addEventListener('change', (e) => {
      showGijon2026 = e.target.checked;
      renderYTD();
    });
    document.getElementById('streak-scale').addEventListener('change', (e) => {
      streakScale = e.target.value;
      renderStreakDist();
    });

    rerenderAll();
  }

  function rerenderAll() {
    Object.values(charts).forEach(c => c && c.destroy());
    charts = {};
    renderYTD();
    renderAnnual('chart-rainy', 'rainy_days', 'Rainy days');
    renderAnnual('chart-total', 'total_mm',   'mm');
    renderAnnual('chart-streak','max_consec', 'Days');
    renderStreakDist();
    renderRatio();
  }

  // Re-render on significant viewport changes
  let lastW = window.innerWidth;
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const w = window.innerWidth;
      const wasMobile = lastW <= 720;
      const isMobile  = w     <= 720;
      lastW = w;
      if (wasMobile !== isMobile && DATA) rerenderAll();
    }, 250);
  });

  // -------- Featured chart: 2026 YTD cumulative RAINY DAYS vs Gijón normals --------
  function renderYTD() {
    if (charts.ytd) { charts.ytd.destroy(); charts.ytd = null; }
    const p = palette();
    const ytdBergen = DATA.ytd_days.bergen;
    const ytdGijon  = DATA.ytd_days.gijon;
    const labels = Array.from({length: 366}, (_, i) => i + 1);

    const gNorm = DATA.normals_days.gijon;
    const bNorm = DATA.normals_days.bergen;

    const datasets = [];

    // Gijón outer band (p10-p90)
    datasets.push({
      label: 'Gijón p10', data: gNorm.p10,
      borderColor: 'transparent', backgroundColor: 'transparent',
      pointRadius: 0, pointHoverRadius: 0, fill: false, tension: 0.3,
      order: 10, _isBoundary: true,
    });
    datasets.push({
      label: 'Gijón normal · 10–90th percentile', data: gNorm.p90,
      borderColor: 'transparent', backgroundColor: p.gijonBand,
      pointRadius: 0, pointHoverRadius: 0, fill: '-1', tension: 0.3, order: 10,
    });
    // Gijón inner band (p25-p75)
    datasets.push({
      label: 'Gijón p25', data: gNorm.p25,
      borderColor: 'transparent', backgroundColor: 'transparent',
      pointRadius: 0, pointHoverRadius: 0, fill: false, tension: 0.3,
      order: 9, _isBoundary: true,
    });
    datasets.push({
      label: 'Gijón normal · 25–75th percentile', data: gNorm.p75,
      borderColor: 'transparent', backgroundColor: p.gijonSoft,
      pointRadius: 0, pointHoverRadius: 0, fill: '-1', tension: 0.3, order: 9,
    });
    // Gijón median
    datasets.push({
      label: 'Gijón median (1995–2024)', data: gNorm.p50,
      borderColor: p.gijon, backgroundColor: 'transparent',
      borderWidth: 1.75, borderDash: [5, 4],
      pointRadius: 0, pointHoverRadius: 4, fill: false, tension: 0.3, order: 7,
    });

    if (showBergenBand) {
      datasets.push({
        label: 'Bergen p10', data: bNorm.p10,
        borderColor: 'transparent', backgroundColor: 'transparent',
        pointRadius: 0, pointHoverRadius: 0, fill: false, tension: 0.3,
        order: 8, _isBoundary: true,
      });
      datasets.push({
        label: 'Bergen normal · 10–90th percentile', data: bNorm.p90,
        borderColor: 'transparent', backgroundColor: p.bergenBand,
        pointRadius: 0, pointHoverRadius: 0, fill: '-1', tension: 0.3, order: 8,
      });
      datasets.push({
        label: 'Bergen median (1995–2024)', data: bNorm.p50,
        borderColor: p.bergen, backgroundColor: 'transparent',
        borderWidth: 1.5, borderDash: [5, 4],
        pointRadius: 0, pointHoverRadius: 4, fill: false, tension: 0.3, order: 6,
      });
    }

    if (showGijon2026) {
      datasets.push({
        label: 'Gijón 2026 YTD',
        data: ytdGijon.concat(Array(366 - ytdGijon.length).fill(null)),
        borderColor: p.gijon, backgroundColor: 'transparent',
        borderWidth: 2, pointRadius: 0, pointHoverRadius: 5,
        pointBackgroundColor: p.gijon, fill: false, tension: 0.2, order: 2,
      });
    }

    // Bergen 2026 YTD — protagonist
    datasets.push({
      label: 'Bergen 2026 YTD',
      data: ytdBergen.concat(Array(366 - ytdBergen.length).fill(null)),
      borderColor: p.bergen, backgroundColor: 'transparent',
      borderWidth: 2.75, pointRadius: 0, pointHoverRadius: 6,
      pointBackgroundColor: p.bergen, fill: false, tension: 0.2, order: 1,
    });

    const ctx = document.getElementById('chart-ytd').getContext('2d');
    charts.ytd = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom', align: 'start',
            labels: {
              color: p.muted, boxWidth: 14, boxHeight: 3, padding: 14,
              usePointStyle: false,
              filter: (item) => {
                const ds = item.text || '';
                return !ds.endsWith('p10') && !ds.endsWith('p25');
              },
            },
          },
          tooltip: {
            backgroundColor: p.surface, titleColor: p.text, bodyColor: p.text,
            borderColor: p.border, borderWidth: 1, padding: 12,
            titleFont: { weight: '700' },
            bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
            callbacks: {
              title: (items) => 'Day ' + items[0].label + ' · ' + doyToDateLabel(parseInt(items[0].label, 10)),
              label: (item) => {
                if (item.dataset._isBoundary) return null;
                const v = item.parsed.y;
                if (v == null) return null;
                return '  ' + item.dataset.label + ': ' + fmt(v, 1) + ' rainy days';
              },
            },
            filter: (item) => !item.dataset._isBoundary,
          },
        },
        scales: {
          x: {
            type: 'linear', min: 1, max: 366,
            ticks: {
              color: p.muted, autoSkip: false,
              callback: (v) => {
                const idx = MONTH_DOYS.indexOf(Math.round(v));
                return idx >= 0 ? MONTH_LABELS[idx] : '';
              },
              maxRotation: 0,
            },
            grid: { color: p.grid, drawTicks: false },
            border: { color: p.border },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Cumulative rainy days (>1 mm)', color: p.muted, font: { size: 11 } },
            ticks: { color: p.muted, callback: (v) => fmt(v, 0) },
            grid: { color: p.grid },
            border: { color: p.border },
          },
        },
      },
    });

    renderRatio();
  }

  // -------- Ratio caption under YTD chart (rainy-days version) --------
  function renderRatio() {
    const ytdBergen = DATA.ytd_days.bergen;
    const ytdGijon  = DATA.ytd_days.gijon;
    const doy = ytdBergen.length;
    const bergenSoFar = ytdBergen[doy - 1];
    const gijonSoFar  = ytdGijon[doy - 1];
    const gNormMedian = DATA.normals_days.gijon.p50[doy - 1];
    const gNormP90    = DATA.normals_days.gijon.p90[doy - 1];
    const bNormMedian = DATA.normals_days.bergen.p50[doy - 1];

    const ratioVsGijon         = bergenSoFar / gNormMedian;
    const ratioVsBergenNormal  = bergenSoFar / bNormMedian;
    const ratioVsGijonP90      = bergenSoFar / gNormP90;
    const extraDays            = bergenSoFar - gijonSoFar;

    const dateLabel = doyToDateLabel(doy);
    const intensity = ratioVsBergenNormal > 1.05 ? 'a wetter-than-usual'
                     : ratioVsBergenNormal < 0.95 ? 'a drier-than-usual'
                     : 'a fairly typical';

    const el = document.getElementById('ratio-bar');
    el.innerHTML =
      `Through <strong>${dateLabel}</strong>, ` +
      `<span class="bergen-text">Bergen</span> has logged <strong>${fmt(bergenSoFar, 0)} rainy days</strong>` +
      ` — <strong>${fmt(extraDays, 0)} more</strong> than <span class="gijon-text">Gijón</span> (${fmt(gijonSoFar, 0)}), ` +
      `and <strong>${fmt(ratioVsGijon, 2)}×</strong> the Gijón 30-year median for this date ` +
      `(${fmt(gNormMedian, 0)} days), <strong>${fmt(ratioVsGijonP90, 2)}×</strong> Gijón's 90th-percentile wettest pace. ` +
      `Bergen is on ${intensity} year vs its own normal (${fmt(ratioVsBergenNormal, 2)}× the median).`;
  }

  // -------- Annual bar charts --------
  function renderAnnual(canvasId, metricKey, axisLabel) {
    const p = palette();
    const years = DATA.annual.years;
    const bergen = DATA.annual.bergen[metricKey];
    const gijon  = DATA.annual.gijon[metricKey];

    const ctx = document.getElementById(canvasId).getContext('2d');
    charts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: years,
        datasets: [
          { label: 'Bergen', data: bergen, backgroundColor: p.bergen, borderRadius: 3, barPercentage: 0.95, categoryPercentage: 0.85 },
          { label: 'Gijón',  data: gijon,  backgroundColor: p.gijon,  borderRadius: 3, barPercentage: 0.95, categoryPercentage: 0.85 },
        ],
      },
      options: {
        plugins: {
          legend: {
            position: 'top', align: 'end',
            labels: { color: p.muted, boxWidth: 12, boxHeight: 12, padding: 12, font: { size: 11 } },
          },
          tooltip: {
            backgroundColor: p.surface, titleColor: p.text, bodyColor: p.text,
            borderColor: p.border, borderWidth: 1, padding: 10,
            bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
            callbacks: {
              label: (item) => '  ' + item.dataset.label + ': ' + fmt(item.parsed.y, 0) + ' ' + (axisLabel === 'mm' ? 'mm' : 'days'),
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: p.muted, maxRotation: 0, autoSkip: true,
              callback: function(val) {
                const y = this.getLabelForValue(val);
                return (y % 5 === 0) ? y : '';
              },
            },
            grid: { display: false }, border: { color: p.border },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: axisLabel, color: p.muted, font: { size: 11 } },
            ticks: { color: p.muted },
            grid: { color: p.grid }, border: { color: p.border },
          },
        },
      },
    });
  }

  // -------- Streak distribution --------
  function renderStreakDist() {
    const p = palette();
    const bDist = DATA.streak_dist.bergen;
    const gDist = DATA.streak_dist.gijon;

    const maxLen = Math.max(
      ...Object.keys(bDist).map(Number),
      ...Object.keys(gDist).map(Number)
    );
    const labels = [], bergenVals = [], gijonVals = [];
    const nYears = DATA.meta.normal_window[1] - DATA.meta.normal_window[0] + 1;
    for (let k = 1; k <= maxLen; k++) {
      labels.push(k);
      bergenVals.push((bDist[k] || 0) / nYears);
      gijonVals.push((gDist[k] || 0) / nYears);
    }

    if (charts['chart-streak-dist']) charts['chart-streak-dist'].destroy();

    const ctx = document.getElementById('chart-streak-dist').getContext('2d');
    charts['chart-streak-dist'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Bergen', data: bergenVals, backgroundColor: p.bergen, borderRadius: 2, categoryPercentage: 0.9, barPercentage: 0.92 },
          { label: 'Gijón',  data: gijonVals,  backgroundColor: p.gijon,  borderRadius: 2, categoryPercentage: 0.9, barPercentage: 0.92 },
        ],
      },
      options: {
        plugins: {
          legend: { position: 'top', align: 'end', labels: { color: p.muted, boxWidth: 12, boxHeight: 12, padding: 12, font: { size: 11 } } },
          tooltip: {
            backgroundColor: p.surface, titleColor: p.text, bodyColor: p.text,
            borderColor: p.border, borderWidth: 1, padding: 10,
            bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
            callbacks: {
              title: (items) => 'Streak length: ' + items[0].label + ' day' + (items[0].label === '1' ? '' : 's'),
              label: (item) => '  ' + item.dataset.label + ': ' + fmt(item.parsed.y, 2) + ' per year',
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: 'Consecutive rainy days', color: p.muted, font: { size: 11 } },
            ticks: { color: p.muted, autoSkip: true, maxTicksLimit: 20 },
            grid: { display: false }, border: { color: p.border },
          },
          y: {
            type: streakScale === 'log' ? 'logarithmic' : 'linear',
            title: { display: true, text: 'Avg streaks per year', color: p.muted, font: { size: 11 } },
            ticks: { color: p.muted },
            grid: { color: p.grid }, border: { color: p.border },
          },
        },
      },
    });
  }

})();
