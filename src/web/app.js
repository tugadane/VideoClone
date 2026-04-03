// ========================================
// Clone Studio — Frontend Logic (app.js)
// ========================================

let currentFile = null;   // { filepath, filename, size_mb, duration, resolution, ... }
let pollInterval = null;
let isCloning = false;
let outputFolder = '';

// --- Wait for pywebview ---
window.addEventListener('pywebviewready', () => {
    init();
});

// --- Initialize ---
async function init() {
    await loadConfig();
    await checkFFmpeg();
    await loadHistory();
    setupEventListeners();
    updateTemplatePreview();
    showTab('clone');
}

// ========================================
// EVENT LISTENERS
// ========================================
function setupEventListeners() {
    // Window controls
    document.getElementById('btnMinimize').addEventListener('click', () => pywebview.api.minimize_window());
    document.getElementById('btnMaximize').addEventListener('click', () => pywebview.api.toggle_maximize());
    document.getElementById('btnClose').addEventListener('click', () => pywebview.api.close_window());

    // Tab switching
    document.getElementById('btnHistory').addEventListener('click', toggleHistory);

    // Guide modal
    document.getElementById('btnGuide').addEventListener('click', () => {
        document.getElementById('guideModal').classList.remove('hidden');
    });
    document.getElementById('btnCloseGuide').addEventListener('click', () => {
        document.getElementById('guideModal').classList.add('hidden');
    });

    // File selection
    document.getElementById('btnSelectFile').addEventListener('click', selectVideoFile);
    document.getElementById('dropZoneInner').addEventListener('click', (e) => {
        const isLinkArea = e.target.closest('#linkDownloadArea');
        if (e.target.id !== 'btnSelectFile' && !e.target.closest('#btnSelectFile') && !isLinkArea
            && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'BUTTON') {
            selectVideoFile();
        }
    });
    document.getElementById('btnClearFile').addEventListener('click', clearFile);

    // Unified link download
    document.getElementById('btnLinkDownload').addEventListener('click', downloadFromLink);
    document.getElementById('inputLinkUrl').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') downloadFromLink();
    });
    document.getElementById('selectSource').addEventListener('change', updateLinkPlaceholder);

    // Folder
    document.getElementById('btnBrowseFolder').addEventListener('click', selectOutputFolder);

    // Clone controls
    document.getElementById('btnStartClone').addEventListener('click', startCloning);
    document.getElementById('btnCancelClone').addEventListener('click', cancelCloning);
    document.getElementById('btnReset').addEventListener('click', resetAll);

    // Clone count slider
    const rangeEl = document.getElementById('rangeCloneCount');
    rangeEl.addEventListener('input', () => {
        document.getElementById('cloneCountLabel').textContent = rangeEl.value;
        updateEstimates();
        updateTemplatePreview();
    });

    // Template input
    document.getElementById('inputTemplate').addEventListener('input', updateTemplatePreview);

    // Template tags
    document.querySelectorAll('.template-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            const input = document.getElementById('inputTemplate');
            const pos = input.selectionStart || input.value.length;
            const val = input.value;
            input.value = val.slice(0, pos) + tag.dataset.tag + val.slice(pos);
            input.focus();
            updateTemplatePreview();
        });
    });

    // Format change
    document.getElementById('selectFormat').addEventListener('change', () => {
        updateTemplatePreview();
        updateEstimates();
    });

    // Method change
    document.getElementById('selectMethod').addEventListener('change', () => {
        updateEstimates();
        updateFxWarning();
    });

    // Video Effects panel
    document.getElementById('btnToggleEffects').addEventListener('click', toggleEffectsPanel);
    document.getElementById('btnSelectAllFx').addEventListener('click', () => setAllEffects(true));
    document.getElementById('btnDeselectAllFx').addEventListener('click', () => setAllEffects(false));
    document.querySelectorAll('#effectsPanel input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', updateFxWarning);
    });

    // Background Music
    document.getElementById('btnToggleBgm').addEventListener('click', toggleBgmPanel);
    document.getElementById('btnBrowseBgm').addEventListener('click', selectBgmFile);
    document.getElementById('btnClearBgm').addEventListener('click', clearBgmFile);
    document.getElementById('rangeBgmVolume').addEventListener('input', () => {
        document.getElementById('bgmVolumeLabel').textContent = document.getElementById('rangeBgmVolume').value + '%';
    });

    // Text Overlay
    document.getElementById('btnToggleTextOverlay').addEventListener('click', toggleTextOverlayPanel);
    document.getElementById('chkTextOverlay').addEventListener('change', toggleTextOverlayFields);
    document.getElementById('inputOverlayText').addEventListener('input', updateTextPreview);
    document.getElementById('rangeTextSize').addEventListener('input', () => {
        document.getElementById('textSizeLabel').textContent = document.getElementById('rangeTextSize').value + 'px';
        updateTextPreview();
    });
    document.getElementById('selectTextPosition').addEventListener('change', updateTextPreview);
    document.getElementById('selectTextFont').addEventListener('change', updateTextPreview);
    document.getElementById('inputTextColor').addEventListener('input', () => {
        document.getElementById('textColorHex').textContent = document.getElementById('inputTextColor').value;
        updateTextPreview();
    });

    // Video Overlay
    document.getElementById('btnToggleVideoOverlay').addEventListener('click', toggleVideoOverlayPanel);
    document.getElementById('chkVideoOverlay').addEventListener('change', toggleVideoOverlayFields);
    document.getElementById('btnBrowseOverlayVideo').addEventListener('click', selectOverlayVideo);
    document.getElementById('btnClearOverlayVideo').addEventListener('click', clearOverlayVideo);
    document.getElementById('rangeOverlayVideoSize').addEventListener('input', () => {
        document.getElementById('overlayVideoSizeLabel').textContent = document.getElementById('rangeOverlayVideoSize').value + '%';
    });
    document.getElementById('rangeOverlayVideoOpacity').addEventListener('input', () => {
        document.getElementById('overlayVideoOpacityLabel').textContent = document.getElementById('rangeOverlayVideoOpacity').value + '%';
    });

    // History
    document.getElementById('btnClearHistory').addEventListener('click', clearHistory);

    // Settings
    document.getElementById('btnBrowseFFmpeg').addEventListener('click', browseFFmpeg);
    document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);

    // Toggle switches
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => toggleSwitch(btn));
    });

    // Completion modal
    document.getElementById('btnCloseComplete').addEventListener('click', () => {
        document.getElementById('completeModal').classList.add('hidden');
    });
    document.getElementById('btnOpenFolder').addEventListener('click', () => {
        const folder = outputFolder || '';
        if (folder) pywebview.api.open_folder(folder);
        document.getElementById('completeModal').classList.add('hidden');
    });

    // Drag & drop
    setupDragDrop();
}

// ========================================
// VIDEO EFFECTS
// ========================================
const FX_IDS = ['fxBrightness','fxContrast','fxSaturation','fxHue','fxSharpen','fxBlur','fxNoise','fxVignette','fxFlip','fxZoom'];

function toggleEffectsPanel() {
    const panel = document.getElementById('effectsPanel');
    const chevron = document.getElementById('effectsChevron');
    panel.classList.toggle('collapsed');
    chevron.classList.toggle('rotated');
}

function getSelectedEffects() {
    const effects = [];
    FX_IDS.forEach(id => {
        if (document.getElementById(id).checked) {
            effects.push(id.replace('fx', '').toLowerCase());
        }
    });
    return effects;
}

function setAllEffects(checked) {
    FX_IDS.forEach(id => { document.getElementById(id).checked = checked; });
    updateFxWarning();
}

function updateFxWarning() {
    const hasEffects = FX_IDS.some(id => document.getElementById(id).checked);
    const hasText = document.getElementById('chkTextOverlay').checked;
    const hasVideoOverlay = document.getElementById('chkVideoOverlay').checked;
    const method = document.getElementById('selectMethod').value;
    document.getElementById('fxWarning').style.display = (hasEffects && method === 'fast') ? '' : 'none';
    document.getElementById('textOverlayWarning').style.display = (hasText && method === 'fast') ? '' : 'none';
    document.getElementById('videoOverlayWarning').style.display = (hasVideoOverlay && method === 'fast') ? '' : 'none';
}

// ========================================
// BACKGROUND MUSIC
// ========================================
let bgmFile = null; // { filepath, filename }

function toggleBgmPanel() {
    const panel = document.getElementById('bgmPanel');
    const chevron = document.getElementById('bgmChevron');
    panel.classList.toggle('collapsed');
    chevron.classList.toggle('rotated');
}

async function selectBgmFile() {
    const result = await pywebview.api.select_audio_file();
    if (result) {
        bgmFile = result;
        document.getElementById('inputBgmFile').value = result.filename;
        document.getElementById('btnClearBgm').classList.remove('hidden');
    }
}

function clearBgmFile() {
    bgmFile = null;
    document.getElementById('inputBgmFile').value = '';
    document.getElementById('btnClearBgm').classList.add('hidden');
}

function getBgmOptions() {
    if (!bgmFile) return null;
    return {
        filepath: bgmFile.filepath,
        volume: parseInt(document.getElementById('rangeBgmVolume').value),
        loop: document.getElementById('chkBgmLoop').checked,
    };
}

// ========================================
// TEXT OVERLAY
// ========================================
function toggleTextOverlayPanel() {
    const panel = document.getElementById('textOverlayPanel');
    const chevron = document.getElementById('textOverlayChevron');
    panel.classList.toggle('collapsed');
    chevron.classList.toggle('rotated');
}

function toggleTextOverlayFields() {
    const checked = document.getElementById('chkTextOverlay').checked;
    document.getElementById('textOverlayFields').style.display = checked ? '' : 'none';
    const method = document.getElementById('selectMethod').value;
    document.getElementById('textOverlayWarning').style.display = (checked && method === 'fast') ? '' : 'none';
    updateFxWarning();
}

function getTextOverlayOptions() {
    if (!document.getElementById('chkTextOverlay').checked) return null;
    const text = document.getElementById('inputOverlayText').value.trim();
    if (!text) return null;
    return {
        text: text,
        font_size: parseInt(document.getElementById('rangeTextSize').value),
        position: document.getElementById('selectTextPosition').value,
        color: document.getElementById('inputTextColor').value,
        font: document.getElementById('selectTextFont').value,
    };
}

const FONT_FAMILY_MAP = {
    'arial.ttf': 'Arial', 'arialbd.ttf': 'Arial',
    'impact.ttf': 'Impact',
    'times.ttf': 'Times New Roman', 'timesbd.ttf': 'Times New Roman',
    'georgia.ttf': 'Georgia',
    'verdana.ttf': 'Verdana', 'verdanab.ttf': 'Verdana',
    'tahoma.ttf': 'Tahoma',
    'calibri.ttf': 'Calibri', 'calibrib.ttf': 'Calibri',
    'comic.ttf': 'Comic Sans MS',
    'consola.ttf': 'Consolas',
    'trebuc.ttf': 'Trebuchet MS',
    'cour.ttf': 'Courier New',
    'segoeui.ttf': 'Segoe UI', 'segoeuib.ttf': 'Segoe UI',
    'bahnschrift.ttf': 'Bahnschrift',
};

function updateTextPreview() {
    const label = document.getElementById('textPreviewLabel');
    const text = document.getElementById('inputOverlayText').value || 'Your text here';
    const size = parseInt(document.getElementById('rangeTextSize').value);
    const color = document.getElementById('inputTextColor').value;
    const pos = document.getElementById('selectTextPosition').value;
    const fontFile = document.getElementById('selectTextFont').value;
    const fontFamily = FONT_FAMILY_MAP[fontFile] || 'Arial';

    label.textContent = text;
    label.style.fontSize = Math.max(size * 0.5, 10) + 'px';
    label.style.color = color;
    label.style.fontFamily = fontFamily + ', sans-serif';

    // Position mapping
    const posMap = {
        'top-left':      { top: '8px', left: '12px', right: 'auto', bottom: 'auto', transform: 'none', textAlign: 'left' },
        'top-center':    { top: '8px', left: '50%', right: 'auto', bottom: 'auto', transform: 'translateX(-50%)', textAlign: 'center' },
        'top-right':     { top: '8px', left: 'auto', right: '12px', bottom: 'auto', transform: 'none', textAlign: 'right' },
        'center':        { top: '50%', left: '50%', right: 'auto', bottom: 'auto', transform: 'translate(-50%,-50%)', textAlign: 'center' },
        'bottom-left':   { top: 'auto', left: '12px', right: 'auto', bottom: '8px', transform: 'none', textAlign: 'left' },
        'bottom-center': { top: 'auto', left: '50%', right: 'auto', bottom: '8px', transform: 'translateX(-50%)', textAlign: 'center' },
        'bottom-right':  { top: 'auto', left: 'auto', right: '12px', bottom: '8px', transform: 'none', textAlign: 'right' },
    };
    const s = posMap[pos] || posMap['bottom-left'];
    Object.assign(label.style, s);
}

// ========================================
// VIDEO OVERLAY
// ========================================
let overlayVideoFile = null; // { filepath, filename }

function toggleVideoOverlayPanel() {
    const panel = document.getElementById('videoOverlayPanel');
    const chevron = document.getElementById('videoOverlayChevron');
    panel.classList.toggle('collapsed');
    chevron.classList.toggle('rotated');
}

function toggleVideoOverlayFields() {
    const checked = document.getElementById('chkVideoOverlay').checked;
    document.getElementById('videoOverlayFields').style.display = checked ? '' : 'none';
    const method = document.getElementById('selectMethod').value;
    document.getElementById('videoOverlayWarning').style.display = (checked && method === 'fast') ? '' : 'none';
    updateFxWarning();
}

async function selectOverlayVideo() {
    const result = await pywebview.api.select_overlay_video();
    if (result) {
        overlayVideoFile = result;
        document.getElementById('inputOverlayVideo').value = result.filename;
        document.getElementById('btnClearOverlayVideo').classList.remove('hidden');
    }
}

function clearOverlayVideo() {
    overlayVideoFile = null;
    document.getElementById('inputOverlayVideo').value = '';
    document.getElementById('btnClearOverlayVideo').classList.add('hidden');
}

function getVideoOverlayOptions() {
    if (!document.getElementById('chkVideoOverlay').checked) return null;
    if (!overlayVideoFile) return null;
    return {
        filepath: overlayVideoFile.filepath,
        size_pct: parseInt(document.getElementById('rangeOverlayVideoSize').value),
        position: document.getElementById('selectOverlayVideoPosition').value,
        opacity: parseInt(document.getElementById('rangeOverlayVideoOpacity').value),
        loop: document.getElementById('chkOverlayVideoLoop').checked,
    };
}

// ========================================
// DRAG & DROP (visual only — file dialog on click/drop)
// ========================================
function setupDragDrop() {
    const zone = document.getElementById('dropZone');

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('drop-active');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('drop-active');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drop-active');
        selectVideoFile();
    });
}

// ========================================
// FILE SELECTION
// ========================================
async function selectVideoFile() {
    const info = await pywebview.api.select_video_file();
    if (info) {
        onFileSelected(info);
    }
}

function onFileSelected(info) {
    currentFile = info;

    // Show file info
    document.getElementById('fileInfo').classList.remove('hidden');
    document.getElementById('infoFilename').textContent = info.filename || '-';
    document.getElementById('infoFilesize').textContent = info.size_mb ? `${info.size_mb} MB` : '-';
    document.getElementById('infoDuration').textContent = info.duration || '-';
    document.getElementById('infoResolution').textContent = info.resolution || '-';
    document.getElementById('infoCodec').textContent = info.video_codec || '-';
    document.getElementById('infoBitrate').textContent = info.bitrate_kbps ? `${info.bitrate_kbps} Kbps` : '-';

    // Enable start button
    document.getElementById('btnStartClone').disabled = false;

    // Update estimates & preview
    updateEstimates();
    updateTemplatePreview();
}

function clearFile() {
    currentFile = null;
    document.getElementById('fileInfo').classList.add('hidden');
    document.getElementById('btnStartClone').disabled = true;
    document.getElementById('estimateSize').textContent = '-';
    document.getElementById('estimateTime').textContent = '-';
}

async function resetAll() {
    // Stop cloning if active
    if (isCloning) {
        await pywebview.api.cancel_cloning();
        stopPolling();
        isCloning = false;
    }

    // Clear file
    currentFile = null;
    document.getElementById('fileInfo').classList.add('hidden');

    // Reset clone controls
    document.getElementById('btnStartClone').classList.remove('hidden');
    document.getElementById('btnStartClone').disabled = true;
    document.getElementById('btnStartIcon').textContent = 'rocket_launch';
    document.getElementById('btnStartText').textContent = 'START CLONING';
    document.getElementById('btnCancelClone').classList.add('hidden');

    // Reset progress
    document.getElementById('progressSection').style.display = 'none';
    document.getElementById('idleMessage').style.display = '';
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('progressPercent').textContent = '0%';
    document.getElementById('progressLabel').textContent = 'Idle';
    document.getElementById('progressRemaining').textContent = '';
    document.getElementById('taskCounter').textContent = '0/0';
    document.getElementById('taskList').innerHTML = '';

    // Reset estimates
    document.getElementById('estimateSize').textContent = '-';
    document.getElementById('estimateTime').textContent = '-';

    // Reset BGM
    clearBgmFile();
    document.getElementById('rangeBgmVolume').value = 20;
    document.getElementById('bgmVolumeLabel').textContent = '20%';
    document.getElementById('chkBgmLoop').checked = true;

    // Reset Text Overlay
    document.getElementById('chkTextOverlay').checked = false;
    document.getElementById('textOverlayFields').style.display = 'none';
    document.getElementById('inputOverlayText').value = '';
    document.getElementById('rangeTextSize').value = 24;
    document.getElementById('textSizeLabel').textContent = '24px';
    document.getElementById('selectTextPosition').value = 'bottom-left';
    document.getElementById('selectTextFont').value = 'arial.ttf';
    document.getElementById('inputTextColor').value = '#ffffff';
    document.getElementById('textColorHex').textContent = '#ffffff';
    document.getElementById('textOverlayWarning').style.display = 'none';
    updateTextPreview();

    // Reset Video Overlay
    document.getElementById('chkVideoOverlay').checked = false;
    document.getElementById('videoOverlayFields').style.display = 'none';
    clearOverlayVideo();
    document.getElementById('rangeOverlayVideoSize').value = 25;
    document.getElementById('overlayVideoSizeLabel').textContent = '25%';
    document.getElementById('selectOverlayVideoPosition').value = 'bottom-left';
    document.getElementById('rangeOverlayVideoOpacity').value = 100;
    document.getElementById('overlayVideoOpacityLabel').textContent = '100%';
    document.getElementById('chkOverlayVideoLoop').checked = true;
    document.getElementById('videoOverlayWarning').style.display = 'none';

    // Reset link download area
    document.getElementById('inputLinkUrl').value = '';
    document.getElementById('selectSource').value = 'tiktok';
    updateLinkPlaceholder();
    document.getElementById('linkProgress').classList.add('hidden');

    // Reload config defaults
    await loadConfig();
    updateTemplatePreview();
}

// ========================================
// LINK DOWNLOAD (Unified)
// ========================================
const SOURCE_CONFIG = {
    tiktok:   { label: 'TikTok',          placeholder: 'Paste TikTok video link...',          api: 'download_from_tiktok',   progress: 'get_tiktok_download_progress' },
    reels:    { label: 'Instagram Reels',  placeholder: 'Paste Instagram Reels link...',       api: 'download_from_reels',    progress: 'get_reels_download_progress' },
    fbreels:  { label: 'Facebook Reels',   placeholder: 'Paste Facebook Reels/video link...',  api: 'download_from_fbreels',  progress: 'get_fbreels_download_progress' },
    ytshorts: { label: 'YouTube Shorts',   placeholder: 'Paste YouTube Shorts link...',        api: 'download_from_ytshorts', progress: 'get_ytshorts_download_progress' },
    gdrive:   { label: 'Google Drive',     placeholder: 'Paste Google Drive video link...',    api: 'download_from_gdrive',   progress: 'get_gdrive_download_progress' },
};

function updateLinkPlaceholder() {
    const source = document.getElementById('selectSource').value;
    document.getElementById('inputLinkUrl').placeholder = SOURCE_CONFIG[source].placeholder;
}

async function downloadFromLink() {
    const url = document.getElementById('inputLinkUrl').value.trim();
    const source = document.getElementById('selectSource').value;
    const config = SOURCE_CONFIG[source];

    if (!url) {
        alert(`Please paste a ${config.label} link first.`);
        return;
    }

    const btn = document.getElementById('btnLinkDownload');
    const progressEl = document.getElementById('linkProgress');
    btn.disabled = true;
    btn.innerHTML = '<div class="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div> Downloading...';
    progressEl.classList.remove('hidden');

    const poll = setInterval(async () => {
        const prog = await pywebview.api[config.progress]();
        if (prog) {
            document.getElementById('linkProgressBar').style.width = prog.percent + '%';
            document.getElementById('linkProgressPercent').textContent = prog.percent + '%';
            const mb = prog.downloaded_mb || 0;
            const total = prog.total_mb ? ` / ${prog.total_mb} MB` : '';
            const statusLabel = prog.status === 'resolving' ? `Resolving ${config.label} link...`
                : prog.status === 'fetching_info' ? 'Fetching video info...'
                : `Downloading... ${mb} MB${total}`;
            document.getElementById('linkProgressLabel').textContent = statusLabel;
        }
    }, 500);

    const info = await pywebview.api[config.api](url);
    clearInterval(poll);

    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined text-base">cloud_download</span> Download';
    progressEl.classList.add('hidden');
    document.getElementById('linkProgressBar').style.width = '0%';

    if (info && info.error) {
        alert(`${config.label} Error: ` + info.error);
        return;
    }

    if (info) {
        document.getElementById('inputLinkUrl').value = '';
        onFileSelected(info);
    }
}

// ========================================
// OUTPUT FOLDER
// ========================================
async function selectOutputFolder() {
    const folder = await pywebview.api.select_output_folder();
    if (folder) {
        outputFolder = folder;
        document.getElementById('inputOutputFolder').value = folder;
    }
}

// ========================================
// CLONING
// ========================================
async function startCloning() {
    if (!currentFile || isCloning) return;

    const effects = getSelectedEffects();
    const bgmOptions = getBgmOptions();
    const textOverlay = getTextOverlayOptions();
    const videoOverlay = getVideoOverlayOptions();
    const options = {
        source: currentFile.filepath,
        count: parseInt(document.getElementById('rangeCloneCount').value),
        method: document.getElementById('selectMethod').value,
        format: document.getElementById('selectFormat').value,
        output_folder: outputFolder || '',
        template: document.getElementById('inputTemplate').value,
        effects: effects,
        bgm: bgmOptions,
        text_overlay: textOverlay,
        video_overlay: videoOverlay,
    };

    const result = await pywebview.api.start_cloning(options);
    if (result && result.error) {
        alert(result.error);
        return;
    }

    isCloning = true;

    // UI updates
    document.getElementById('btnStartClone').classList.add('hidden');
    document.getElementById('btnCancelClone').classList.remove('hidden');
    document.getElementById('progressSection').style.display = '';
    document.getElementById('idleMessage').style.display = 'none';

    // Start polling
    pollInterval = setInterval(pollProgress, 500);
}

async function cancelCloning() {
    await pywebview.api.cancel_cloning();
    stopPolling();
    isCloning = false;

    document.getElementById('btnStartClone').classList.remove('hidden');
    document.getElementById('btnCancelClone').classList.add('hidden');
    document.getElementById('progressLabel').textContent = 'Cancelled';
}

function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

async function pollProgress() {
    const data = await pywebview.api.get_clone_progress();
    if (!data) return;

    updateProgress(data);

    if (data.status === 'completed') {
        stopPolling();
        isCloning = false;
        onCloneComplete(data);
    } else if (data.status === 'error') {
        stopPolling();
        isCloning = false;
        onCloneError(data);
    } else if (data.status === 'cancelled') {
        stopPolling();
        isCloning = false;
    }
}

// ========================================
// PROGRESS UI
// ========================================
function updateProgress(data) {
    // Progress bar
    document.getElementById('progressBar').style.width = data.percent + '%';
    document.getElementById('progressPercent').textContent = data.percent + '%';

    // Counter
    const doneCount = data.items ? data.items.filter(i => i.status === 'done').length : 0;
    document.getElementById('taskCounter').textContent = `${doneCount}/${data.total}`;

    // Label
    if (data.status === 'running') {
        document.getElementById('progressLabel').textContent = `Processing clone #${data.current_index}...`;
    }

    // Remaining
    if (data.estimated_remaining > 0) {
        document.getElementById('progressRemaining').textContent = `~${Math.round(data.estimated_remaining)}s remaining`;
    } else {
        document.getElementById('progressRemaining').textContent = '';
    }

    // Task list
    updateTaskList(data.items || []);
}

function updateTaskList(items) {
    const container = document.getElementById('taskList');
    container.innerHTML = '';

    items.forEach(item => {
        const div = document.createElement('div');

        if (item.status === 'done') {
            div.className = 'flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/5';
            div.innerHTML = `
                <span class="material-symbols-outlined text-green-500 text-base">check_circle</span>
                <div class="flex-1 min-w-0">
                    <p class="text-[11px] text-slate-300 truncate">${escapeHtml(item.filename)}</p>
                </div>
                <span class="text-[10px] text-slate-500 shrink-0">${item.time}s</span>
            `;
        } else if (item.status === 'processing') {
            div.className = 'flex items-center gap-3 px-3 py-2.5 rounded-lg bg-primary/10 border border-primary/30';
            div.innerHTML = `
                <div class="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0"></div>
                <div class="flex-1 min-w-0">
                    <p class="text-[11px] text-slate-100 truncate">${escapeHtml(item.filename || 'Processing...')}</p>
                </div>
                <span class="text-[10px] text-primary font-bold shrink-0">In Progress</span>
            `;
        } else {
            div.className = 'flex items-center gap-3 px-3 py-2.5 rounded-lg border border-white/5 opacity-40';
            div.innerHTML = `
                <span class="material-symbols-outlined text-slate-500 text-base">hourglass_empty</span>
                <div class="flex-1 min-w-0">
                    <p class="text-[11px] text-slate-500 truncate">Clone #${item.index}</p>
                </div>
            `;
        }

        container.appendChild(div);
    });

    // Scroll to active item
    const activeItem = container.querySelector('.bg-primary\\/10');
    if (activeItem) {
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function onCloneComplete(data) {
    document.getElementById('btnStartClone').classList.remove('hidden');
    document.getElementById('btnCancelClone').classList.add('hidden');
    document.getElementById('progressLabel').textContent = 'Completed!';
    document.getElementById('progressPercent').textContent = '100%';
    document.getElementById('progressBar').style.width = '100%';
    document.getElementById('progressRemaining').textContent = '';

    const count = data.total || 0;
    const elapsed = data.elapsed || 0;
    document.getElementById('completeMessage').textContent = `${count} clones generated successfully.`;
    document.getElementById('completeTime').textContent = `Total time: ${elapsed}s`;
    document.getElementById('completeModal').classList.remove('hidden');

    // Refresh history
    loadHistory();
}

function onCloneError(data) {
    document.getElementById('btnStartClone').classList.remove('hidden');
    document.getElementById('btnCancelClone').classList.add('hidden');
    document.getElementById('progressLabel').textContent = 'Error: ' + (data.error || 'Unknown error');
    alert('Cloning failed: ' + (data.error || 'Unknown error'));
}

// ========================================
// ESTIMATES
// ========================================
function updateEstimates() {
    if (!currentFile) return;

    const count = parseInt(document.getElementById('rangeCloneCount').value);
    const method = document.getElementById('selectMethod').value;
    const sizeMB = currentFile.size_mb || 0;

    // Size estimate
    const totalSize = (sizeMB * count).toFixed(1);
    document.getElementById('estimateSize').textContent = totalSize >= 1024
        ? `${(totalSize / 1024).toFixed(1)} GB`
        : `${totalSize} MB`;

    // Time estimate
    const perClone = method === 'fast' ? 4 : 15;
    const totalSec = perClone * count;
    if (totalSec >= 60) {
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        document.getElementById('estimateTime').textContent = `~ ${min}m ${sec}s`;
    } else {
        document.getElementById('estimateTime').textContent = `~ ${totalSec}s`;
    }
}

// ========================================
// TEMPLATE PREVIEW
// ========================================
function updateTemplatePreview() {
    const template = document.getElementById('inputTemplate').value;
    const fmt = document.getElementById('selectFormat').value;
    const title = currentFile ? currentFile.filename.replace(/\.[^/.]+$/, '') : 'my_video';
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '-');

    let preview = template
        .replace(/{title}/g, title)
        .replace(/{index}/g, '01')
        .replace(/{date}/g, date)
        .replace(/{time}/g, time)
        .replace(/{rand}/g, Math.random().toString(36).slice(2, 8));

    document.getElementById('templatePreview').textContent = `${preview}.${fmt}`;
}

// ========================================
// TAB SWITCHING
// ========================================
function toggleHistory() {
    const historyTab = document.getElementById('tab-history');
    const btn = document.getElementById('btnHistory');
    const isVisible = !historyTab.classList.contains('hidden');

    document.querySelectorAll('.tab-view').forEach(v => v.classList.add('hidden'));

    if (isVisible) {
        showTab('clone');
        btn.classList.remove('text-primary', 'bg-primary/10');
        btn.classList.add('text-slate-400');
    } else {
        showTab('history');
        loadHistory();
        btn.classList.add('text-primary', 'bg-primary/10');
        btn.classList.remove('text-slate-400');
    }
}

function showTab(name) {
    document.querySelectorAll('.tab-view').forEach(v => v.classList.add('hidden'));
    const tab = document.getElementById('tab-' + name);
    if (tab) tab.classList.remove('hidden');
}

// ========================================
// HISTORY
// ========================================
async function loadHistory() {
    const entries = await pywebview.api.get_history();
    const container = document.getElementById('historyList');
    const emptyEl = document.getElementById('historyEmpty');

    // Clear existing items (except empty message)
    container.querySelectorAll('.history-item').forEach(el => el.remove());

    if (!entries || entries.length === 0) {
        emptyEl.classList.remove('hidden');
        return;
    }

    emptyEl.classList.add('hidden');

    entries.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'history-item bg-surface rounded-xl border border-white/5 p-5 flex items-center justify-between hover:border-primary/20 transition-colors';
        div.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="size-11 bg-primary/10 rounded-lg flex items-center justify-center">
                    <span class="material-symbols-outlined text-primary">videocam</span>
                </div>
                <div>
                    <h4 class="text-sm font-semibold text-white">${escapeHtml(entry.source_file)}</h4>
                    <p class="text-xs text-slate-500 mt-1 flex items-center gap-3">
                        <span class="flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">calendar_today</span> ${entry.timestamp ? entry.timestamp.slice(0, 16).replace('T', ' ') : '-'}</span>
                        <span>${entry.duration || '-'}</span>
                        <span class="text-primary capitalize">${entry.method || '-'}</span>
                        <span>${entry.elapsed_total || 0}s</span>
                    </p>
                </div>
            </div>
            <div class="text-right">
                <p class="text-2xl font-black text-primary">${entry.clone_count || 0}</p>
                <p class="text-[10px] text-slate-500 uppercase tracking-wider font-bold">clones</p>
            </div>
        `;
        container.appendChild(div);
    });
}

async function clearHistory() {
    await pywebview.api.clear_history();
    loadHistory();
}

// ========================================
// FFMPEG CHECK
// ========================================
async function checkFFmpeg() {
    const result = await pywebview.api.check_ffmpeg();
    const dot = document.getElementById('ffmpegDot');
    const status = document.getElementById('ffmpegStatus');

    if (result && result.available) {
        dot.className = 'size-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(0,200,83,0.5)]';
        const ver = result.version || 'FFmpeg';
        const shortVer = ver.length > 40 ? ver.slice(0, 40) + '...' : ver;
        status.innerHTML = `${escapeHtml(shortVer)} · <span class="text-green-500 font-semibold">Ready</span>`;
    } else {
        dot.className = 'size-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(255,23,68,0.5)]';
        status.innerHTML = `FFmpeg not found · <span class="text-red-500 font-semibold">Not Ready</span>`;
    }
}

// ========================================
// CONFIG / SETTINGS
// ========================================
async function loadConfig() {
    const config = await pywebview.api.get_config();
    if (!config) return;

    // Apply to main view
    document.getElementById('rangeCloneCount').value = config.default_clone_count || 10;
    document.getElementById('cloneCountLabel').textContent = config.default_clone_count || 10;
    document.getElementById('selectFormat').value = config.default_format || 'mp4';
    document.getElementById('selectMethod').value = config.default_method || 'fast';
    document.getElementById('inputTemplate').value = config.default_template || '{title}_clone{index}_{date}';

    outputFolder = config.default_output_folder || '';
    document.getElementById('inputOutputFolder').value = outputFolder;
    document.getElementById('inputOutputFolder').placeholder = outputFolder || 'Same as source file';

    // Tampilkan path lengkap folder default
    if (outputFolder) {
        const fullPath = await pywebview.api.get_full_path(outputFolder);
        if (fullPath) {
            document.getElementById('inputOutputFolder').value = fullPath;
            outputFolder = fullPath;
        }
    }

    // Apply to settings modal
    document.getElementById('settingsFFmpegPath').value = config.ffmpeg_path || './ffmpeg/ffmpeg.exe';
    document.getElementById('settingsCloneCount').value = config.default_clone_count || 10;
    document.getElementById('settingsFormat').value = config.default_format || 'mp4';
    document.getElementById('settingsTemplate').value = config.default_template || '{title}_clone{index}_{date}';

    // Toggles
    setToggle(document.getElementById('togglePopup'), config.notify_popup !== false);
    setToggle(document.getElementById('toggleSound'), config.notify_sound !== false);
}

async function saveSettings() {
    const config = {
        ffmpeg_path: document.getElementById('settingsFFmpegPath').value,
        default_clone_count: parseInt(document.getElementById('settingsCloneCount').value) || 10,
        default_format: document.getElementById('settingsFormat').value,
        default_template: document.getElementById('settingsTemplate').value,
        notify_popup: document.getElementById('togglePopup').classList.contains('bg-primary'),
        notify_sound: document.getElementById('toggleSound').classList.contains('bg-primary'),
    };

    await pywebview.api.save_config(config);
    document.getElementById('guideModal').classList.add('hidden');

    // Apply to main view
    await loadConfig();
    await checkFFmpeg();
    updateTemplatePreview();
}

async function browseFFmpeg() {
    const path = await pywebview.api.select_ffmpeg_path();
    if (path) {
        document.getElementById('settingsFFmpegPath').value = path;
        await checkFFmpeg();
    }
}

// ========================================
// TOGGLE SWITCH
// ========================================
function toggleSwitch(el) {
    const isActive = el.classList.contains('bg-primary');
    if (isActive) {
        el.classList.remove('bg-primary');
        el.classList.add('bg-white/10');
        el.querySelector('span').classList.remove('translate-x-5');
    } else {
        el.classList.add('bg-primary');
        el.classList.remove('bg-white/10');
        el.querySelector('span').classList.add('translate-x-5');
    }
}

function setToggle(el, active) {
    if (active) {
        el.classList.add('bg-primary');
        el.classList.remove('bg-white/10');
        el.querySelector('span').classList.add('translate-x-5');
    } else {
        el.classList.remove('bg-primary');
        el.classList.add('bg-white/10');
        el.querySelector('span').classList.remove('translate-x-5');
    }
}

// ========================================
// UTILITY
// ========================================
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
