// ========================================
// Clone Studio — Frontend Logic (app.js)
// ========================================

let currentFile = null;   // { filepath, filename, size_mb, duration, resolution, ... }
let sourceFiles = [];     // Array of { filepath, filename, size_mb, duration, resolution, ..., cloneCount }
let pollInterval = null;
let isCloning = false;
let outputFolder = '';
let batchAutoHidePreference = true;
let sourceListCollapsed = false;
let sourceListManualOverride = false;

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
    // Avoid accidental file-dialog popups from nested controls inside the drop zone.
    // File picker is opened only by the explicit button or drag-drop.
    document.getElementById('btnClearFile').addEventListener('click', clearFile);

    // Multi-source controls
    document.getElementById('btnClearAllSources').addEventListener('click', clearAllSources);
    document.getElementById('btnToggleSourceList').addEventListener('click', toggleSourceListCompact);

    // Unified link download
    document.getElementById('btnLinkDownload').addEventListener('click', downloadFromLink);
    document.getElementById('inputLinkUrl').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') downloadFromLink();
    });
    document.getElementById('selectSource').addEventListener('change', updateLinkPlaceholder);

    // Batch link download
    document.getElementById('btnModeSingle').addEventListener('click', () => setLinkMode('single'));
    document.getElementById('btnModeBatch').addEventListener('click', () => setLinkMode('batch'));
    document.getElementById('inputBatchLinks').addEventListener('input', updateBatchLinkCount);
    document.getElementById('btnBatchDownload').addEventListener('click', batchDownloadFromLinks);

    // FB Reels scraper
    document.getElementById('btnScrapeFbReels').addEventListener('click', scrapeFbReels);
    document.getElementById('inputFbPageUrl').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') scrapeFbReels();
    });
    document.getElementById('btnFbSelectAll').addEventListener('click', () => fbScrapeSelectAll(true));
    document.getElementById('btnFbDeselectAll').addEventListener('click', () => fbScrapeSelectAll(false));
    document.getElementById('btnFbAddToBatch').addEventListener('click', fbAddSelectedToBatch);
    document.getElementById('btnFbLogin').addEventListener('click', fbLogin);
    document.getElementById('btnFbLogout').addEventListener('click', fbLogout);
    checkFbLoginStatus();

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
        // In single-source mode, slider directly controls the clone count
        if (sourceFiles.length === 1) {
            sourceFiles[0].cloneCount = parseInt(rangeEl.value);
        }
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

    // Quality change
    document.getElementById('selectQuality').addEventListener('change', () => {
        updateEstimates();
        const q = document.getElementById('selectQuality').value;
        document.getElementById('qualityWarning').style.display = q !== 'auto' ? '' : 'none';
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
    document.getElementById('btnBgmLinkDownload').addEventListener('click', downloadBgmFromLink);
    document.getElementById('inputBgmLinkUrl').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') downloadBgmFromLink();
    });

    // Source Audio
    document.getElementById('btnToggleSourceAudio').addEventListener('click', toggleSourceAudioPanel);
    document.getElementById('selectSourceAudio').addEventListener('change', () => {
        const val = document.getElementById('selectSourceAudio').value;
        document.getElementById('sourceAudioVolumeFields').style.display = val === 'custom' ? '' : 'none';
    });
    document.getElementById('rangeSourceAudioVolume').addEventListener('input', () => {
        document.getElementById('sourceAudioVolumeLabel').textContent = document.getElementById('rangeSourceAudioVolume').value + '%';
    });

    // Text Overlay
    document.getElementById('btnToggleTextOverlay').addEventListener('click', toggleTextOverlayPanel);
    document.getElementById('btnAddTextOverlay').addEventListener('click', addTextOverlay);

    // Video Overlay
    document.getElementById('btnToggleVideoOverlay').addEventListener('click', toggleVideoOverlayPanel);
    document.getElementById('btnAddVideoOverlay').addEventListener('click', addVideoOverlay);

    // Image Overlay
    document.getElementById('btnToggleImageOverlay').addEventListener('click', toggleImageOverlayPanel);
    document.getElementById('btnAddImageOverlay').addEventListener('click', addImageOverlay);

    // Hide Watermark Region
    document.getElementById('btnToggleWatermarkHide').addEventListener('click', toggleWatermarkHidePanel);
    document.getElementById('btnAddWatermarkRegion').addEventListener('click', () => addWatermarkRegion());
    document.querySelectorAll('[data-wm-preset]').forEach(btn => {
        btn.addEventListener('click', () => addWatermarkRegion(btn.getAttribute('data-wm-preset')));
    });

    // Overlay Preview
    document.getElementById('btnTogglePreview').addEventListener('click', togglePreviewPanel);

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
    const method = document.getElementById('selectMethod').value;
    document.getElementById('fxWarning').style.display = (hasEffects && method === 'fast') ? '' : 'none';
    updateOverlayWarnings();
}

// ========================================
// SOURCE AUDIO
// ========================================
function toggleSourceAudioPanel() {
    const panel = document.getElementById('sourceAudioPanel');
    const chevron = document.getElementById('sourceAudioChevron');
    panel.classList.toggle('collapsed');
    chevron.classList.toggle('rotated');
}

function getSourceAudioOptions() {
    const mode = document.getElementById('selectSourceAudio').value;
    if (mode === 'keep') return { mode: 'keep', volume: 100 };
    if (mode === 'mute') return { mode: 'mute', volume: 0 };
    return { mode: 'custom', volume: parseInt(document.getElementById('rangeSourceAudioVolume').value) };
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

async function downloadBgmFromLink() {
    const url = document.getElementById('inputBgmLinkUrl').value.trim();
    const source = document.getElementById('selectBgmSource').value;
    const labels = { tiktok: 'TikTok', reels: 'Instagram Reels', fbreels: 'Facebook Reels', ytshorts: 'YouTube Shorts', shopee: 'Shopee' };

    if (!url) {
        alert(`Please paste a ${labels[source]} link first.`);
        return;
    }

    const btn = document.getElementById('btnBgmLinkDownload');
    const progressEl = document.getElementById('bgmLinkProgress');
    btn.disabled = true;
    btn.innerHTML = '<div class="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div> Extracting...';
    progressEl.classList.remove('hidden');

    const poll = setInterval(async () => {
        const prog = await pywebview.api.get_bgm_extract_progress();
        if (prog) {
            document.getElementById('bgmLinkProgressBar').style.width = prog.percent + '%';
            document.getElementById('bgmLinkProgressPercent').textContent = prog.percent + '%';
            document.getElementById('bgmLinkProgressLabel').textContent = prog.label || 'Extracting audio...';
        }
    }, 500);

    const result = await pywebview.api.extract_bgm_from_link(source, url);
    clearInterval(poll);

    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined text-base">music_note</span> Extract';
    progressEl.classList.add('hidden');
    document.getElementById('bgmLinkProgressBar').style.width = '0%';

    if (result && result.error) {
        alert('Error: ' + result.error);
        return;
    }

    if (result && result.filepath) {
        bgmFile = result;
        document.getElementById('inputBgmFile').value = result.filename;
        document.getElementById('btnClearBgm').classList.remove('hidden');
        document.getElementById('inputBgmLinkUrl').value = '';
    }
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
// TEXT OVERLAY (Multiple)
// ========================================
let textOverlayCounter = 0;

function toggleTextOverlayPanel() {
    const panel = document.getElementById('textOverlayPanel');
    const chevron = document.getElementById('textOverlayChevron');
    panel.classList.toggle('collapsed');
    chevron.classList.toggle('rotated');
}

const FONT_OPTIONS_HTML = `
<option value="arial.ttf" style="font-family:Arial">Arial</option>
<option value="arialbd.ttf" style="font-family:Arial">Arial Bold</option>
<option value="impact.ttf" style="font-family:Impact">Impact</option>
<option value="times.ttf" style="font-family:'Times New Roman'">Times New Roman</option>
<option value="timesbd.ttf" style="font-family:'Times New Roman'">Times New Roman Bold</option>
<option value="georgia.ttf" style="font-family:Georgia">Georgia</option>
<option value="verdana.ttf" style="font-family:Verdana">Verdana</option>
<option value="verdanab.ttf" style="font-family:Verdana">Verdana Bold</option>
<option value="tahoma.ttf" style="font-family:Tahoma">Tahoma</option>
<option value="calibri.ttf" style="font-family:Calibri">Calibri</option>
<option value="calibrib.ttf" style="font-family:Calibri">Calibri Bold</option>
<option value="comic.ttf" style="font-family:'Comic Sans MS'">Comic Sans</option>
<option value="consola.ttf" style="font-family:Consolas">Consolas</option>
<option value="trebuc.ttf" style="font-family:'Trebuchet MS'">Trebuchet MS</option>
<option value="cour.ttf" style="font-family:'Courier New'">Courier New</option>
<option value="segoeui.ttf" style="font-family:'Segoe UI'">Segoe UI</option>
<option value="segoeuib.ttf" style="font-family:'Segoe UI'">Segoe UI Bold</option>
<option value="bahnschrift.ttf" style="font-family:Bahnschrift">Bahnschrift</option>`;

function addTextOverlay() {
    const idx = textOverlayCounter++;
    const num = document.getElementById('textOverlayItems').children.length + 1;
    const card = document.createElement('div');
    card.className = 'bg-card rounded-lg border border-white/10 p-3 space-y-3';
    card.dataset.textIdx = idx;
    card.innerHTML = `
        <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-primary">Text #${num}</span>
            <button class="text-slate-500 hover:text-red-500 transition-colors btn-remove-text" data-idx="${idx}">
                <span class="material-symbols-outlined text-sm">close</span>
            </button>
        </div>
        <div class="space-y-1">
            <label class="text-xs font-semibold text-slate-400">Text <span class="text-slate-600">(supports multiple lines)</span></label>
            <textarea class="w-full bg-black border border-white/10 rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:border-primary focus:ring-1 focus:ring-primary resize-none custom-scrollbar txt-overlay-text" placeholder="Enter text to overlay...&#10;Line 2...&#10;Line 3..." rows="3" maxlength="300"></textarea>
        </div>
        <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400">Font</label>
                <select class="w-full bg-black border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:border-primary focus:ring-1 focus:ring-primary appearance-none txt-overlay-font">${FONT_OPTIONS_HTML}</select>
            </div>
            <div class="space-y-2">
                <div class="flex justify-between items-center">
                    <label class="text-xs font-semibold text-slate-400">Font Size</label>
                    <span class="text-primary font-bold text-sm txt-overlay-size-label">24px</span>
                </div>
                <input class="w-full h-1.5 bg-black rounded-lg appearance-none cursor-pointer accent-primary txt-overlay-size" min="10" max="80" type="range" value="24"/>
                <div class="flex justify-between text-[10px] text-slate-500 font-bold"><span>10px</span><span>80px</span></div>
            </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400">Position</label>
                <select class="w-full bg-black border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:border-primary focus:ring-1 focus:ring-primary appearance-none txt-overlay-position">
                    <option value="top-left">Top Left</option>
                    <option value="top-center">Top Center</option>
                    <option value="top-right">Top Right</option>
                    <option value="center-left">Center Left</option>
                    <option value="center-center">Center Center</option>
                    <option value="center-right">Center Right</option>
                    <option value="bottom-left" selected>Bottom Left</option>
                    <option value="bottom-center">Bottom Center</option>
                    <option value="bottom-right">Bottom Right</option>
                </select>
            </div>
            <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400">Font Color</label>
                <div class="flex gap-2 items-center">
                    <input type="color" value="#ffffff" class="w-10 h-10 rounded-lg border border-white/10 bg-black cursor-pointer txt-overlay-color"/>
                    <span class="text-xs text-slate-400 txt-overlay-color-hex">#ffffff</span>
                </div>
            </div>
        </div>
    `;
    document.getElementById('textOverlayItems').appendChild(card);

    // Wire up events within this card
    card.querySelector('.btn-remove-text').addEventListener('click', () => removeTextOverlay(card));
    card.querySelector('.txt-overlay-size').addEventListener('input', (e) => {
        card.querySelector('.txt-overlay-size-label').textContent = e.target.value + 'px';
        updatePhonePreview();
    });
    card.querySelector('.txt-overlay-color').addEventListener('input', (e) => {
        card.querySelector('.txt-overlay-color-hex').textContent = e.target.value;
        updatePhonePreview();
    });
    card.querySelector('.txt-overlay-text').addEventListener('input', () => updatePhonePreview());
    card.querySelector('.txt-overlay-position').addEventListener('change', () => updatePhonePreview());
    card.querySelector('.txt-overlay-font').addEventListener('change', () => updatePhonePreview());

    updateOverlayWarnings();
    updatePhonePreview();
}

function removeTextOverlay(card) {
    card.remove();
    // Renumber remaining cards
    document.querySelectorAll('#textOverlayItems > div').forEach((c, i) => {
        c.querySelector('.text-primary').textContent = `Text #${i + 1}`;
    });
    updateOverlayWarnings();
    updatePhonePreview();
}

function getTextOverlayOptions() {
    const items = document.querySelectorAll('#textOverlayItems > div');
    if (items.length === 0) return null;
    const overlays = [];
    items.forEach(card => {
        const text = card.querySelector('.txt-overlay-text').value.trim();
        if (!text) return;
        overlays.push({
            text: text,
            font_size: parseInt(card.querySelector('.txt-overlay-size').value),
            position: card.querySelector('.txt-overlay-position').value,
            color: card.querySelector('.txt-overlay-color').value,
            font: card.querySelector('.txt-overlay-font').value,
        });
    });
    return overlays.length > 0 ? overlays : null;
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

function updateOverlayWarnings() {
    const hasText = document.querySelectorAll('#textOverlayItems > div').length > 0;
    const hasVideo = document.querySelectorAll('#videoOverlayItems > div').length > 0;
    const hasImage = document.querySelectorAll('#imageOverlayItems > div').length > 0;
    const method = document.getElementById('selectMethod').value;
    document.getElementById('textOverlayWarning').classList.toggle('hidden', !(hasText && method === 'fast'));
    document.getElementById('videoOverlayWarning').classList.toggle('hidden', !(hasVideo && method === 'fast'));
    const imgWarn = document.getElementById('imageOverlayWarning');
    if (imgWarn) imgWarn.classList.toggle('hidden', !(hasImage && method === 'fast'));
}

// ========================================
// VIDEO OVERLAY (Multiple)
// ========================================
let videoOverlayCounter = 0;
const videoOverlayFiles = {}; // { idx: { filepath, filename } }

function toggleVideoOverlayPanel() {
    const panel = document.getElementById('videoOverlayPanel');
    const chevron = document.getElementById('videoOverlayChevron');
    panel.classList.toggle('collapsed');
    chevron.classList.toggle('rotated');
}

function togglePreviewPanel() {
    const panel = document.getElementById('previewPanel');
    const chevron = document.getElementById('previewChevron');
    panel.classList.toggle('collapsed');
    chevron.classList.toggle('rotated');
}

function addVideoOverlay() {
    const idx = videoOverlayCounter++;
    const num = document.getElementById('videoOverlayItems').children.length + 1;
    const card = document.createElement('div');
    card.className = 'bg-card rounded-lg border border-white/10 p-3 space-y-3';
    card.dataset.videoIdx = idx;
    card.innerHTML = `
        <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-primary">Video #${num}</span>
            <button class="text-slate-500 hover:text-red-500 transition-colors btn-remove-video" data-idx="${idx}">
                <span class="material-symbols-outlined text-sm">close</span>
            </button>
        </div>
        <div class="flex gap-2">
            <input class="flex-1 bg-black border border-white/10 rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:border-primary focus:ring-1 focus:ring-primary vid-overlay-file" placeholder="No overlay video selected" type="text" readonly/>
            <button class="px-4 py-2.5 bg-card text-slate-200 rounded-lg border border-white/10 hover:bg-white/5 hover:border-primary/30 transition-colors text-sm font-medium btn-browse-vid">Browse</button>
            <button class="px-3 py-2.5 text-slate-500 hover:text-red-500 rounded-lg hover:bg-red-500/10 transition-colors hidden btn-clear-vid">
                <span class="material-symbols-outlined text-sm">close</span>
            </button>
        </div>
        <div class="border-t border-white/5 pt-3">
            <p class="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2 text-center">or download from link</p>
            <div class="flex gap-2">
                <select class="bg-black border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:border-primary focus:ring-1 focus:ring-primary appearance-none shrink-0 w-[140px] vid-overlay-source">
                    <option value="tiktok">TikTok</option>
                    <option value="reels">Instagram Reels</option>
                    <option value="fbreels">Facebook Reels</option>
                    <option value="ytshorts">YT Shorts</option>
                    <option value="shopee">Shopee</option>
                </select>
                <input class="flex-1 bg-black border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:border-primary focus:ring-1 focus:ring-primary placeholder-slate-600 vid-overlay-link-url" type="text" placeholder="Paste video link here..."/>
                <button class="px-3 py-2.5 bg-card text-slate-200 rounded-lg border border-white/10 hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-all text-sm font-bold flex items-center gap-1 shrink-0 btn-vid-link-download">
                    <span class="material-symbols-outlined text-base">cloud_download</span> Download
                </button>
            </div>
            <div class="hidden mt-2 vid-overlay-link-progress">
                <div class="flex justify-between text-[10px] text-slate-400 mb-1">
                    <span class="vid-overlay-link-progress-label">Downloading...</span>
                    <span class="text-primary font-bold vid-overlay-link-progress-percent">0%</span>
                </div>
                <div class="w-full h-1.5 bg-black rounded-full overflow-hidden">
                    <div class="bg-gradient-to-r from-orange-600 to-primary h-full rounded-full transition-all duration-300 vid-overlay-link-progress-bar" style="width: 0%"></div>
                </div>
            </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
            <div class="space-y-2">
                <div class="flex justify-between items-center">
                    <label class="text-xs font-semibold text-slate-400">Overlay Size</label>
                    <span class="text-primary font-bold text-sm vid-overlay-size-label">25%</span>
                </div>
                <input class="w-full h-1.5 bg-black rounded-lg appearance-none cursor-pointer accent-primary vid-overlay-size" min="10" max="100" type="range" value="25"/>
                <div class="flex justify-between text-[10px] text-slate-500 font-bold"><span>10%</span><span>100%</span></div>
            </div>
            <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400">Position</label>
                <select class="w-full bg-black border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:border-primary focus:ring-1 focus:ring-primary appearance-none vid-overlay-position">
                    <option value="top-left">Top Left</option>
                    <option value="top-center">Top Center</option>
                    <option value="top-right">Top Right</option>
                    <option value="center-left">Center Left</option>
                    <option value="center-center">Center Center</option>
                    <option value="center-right">Center Right</option>
                    <option value="bottom-left" selected>Bottom Left</option>
                    <option value="bottom-center">Bottom Center</option>
                    <option value="bottom-right">Bottom Right</option>
                </select>
            </div>
        </div>
        <div class="space-y-2">
            <div class="flex justify-between items-center">
                <label class="text-xs font-semibold text-slate-400">Opacity</label>
                <span class="text-primary font-bold text-sm vid-overlay-opacity-label">100%</span>
            </div>
            <input class="w-full h-1.5 bg-black rounded-lg appearance-none cursor-pointer accent-primary vid-overlay-opacity" min="10" max="100" type="range" value="100"/>
            <div class="flex justify-between text-[10px] text-slate-500 font-bold"><span>10%</span><span>100%</span></div>
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" class="accent-primary vid-overlay-loop" checked/>
            <span class="text-xs text-slate-300">Loop overlay video if shorter than main video</span>
        </label>
        <div class="border-t border-white/5 pt-3 space-y-3">
            <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" class="accent-primary vid-overlay-chromakey"/>
                <span class="text-xs text-slate-300 font-semibold">Green Screen (Chroma Key)</span>
            </label>
            <div class="vid-overlay-chromakey-options hidden space-y-3">
                <div class="flex items-center gap-3">
                    <label class="text-xs font-semibold text-slate-400 shrink-0">Key Color</label>
                    <input type="color" class="w-8 h-8 rounded cursor-pointer border border-white/10 vid-overlay-chromakey-color" value="#00ff00"/>
                    <span class="text-xs text-slate-500 vid-overlay-chromakey-color-label">#00ff00</span>
                </div>
                <div class="space-y-2">
                    <div class="flex justify-between items-center">
                        <label class="text-xs font-semibold text-slate-400">Similarity</label>
                        <span class="text-primary font-bold text-sm vid-overlay-chromakey-similarity-label">0.3</span>
                    </div>
                    <input class="w-full h-1.5 bg-black rounded-lg appearance-none cursor-pointer accent-primary vid-overlay-chromakey-similarity" min="1" max="10" type="range" value="3"/>
                    <div class="flex justify-between text-[10px] text-slate-500 font-bold"><span>Low</span><span>High</span></div>
                </div>
                <div class="space-y-2">
                    <div class="flex justify-between items-center">
                        <label class="text-xs font-semibold text-slate-400">Blend</label>
                        <span class="text-primary font-bold text-sm vid-overlay-chromakey-blend-label">0.1</span>
                    </div>
                    <input class="w-full h-1.5 bg-black rounded-lg appearance-none cursor-pointer accent-primary vid-overlay-chromakey-blend" min="0" max="10" type="range" value="1"/>
                    <div class="flex justify-between text-[10px] text-slate-500 font-bold"><span>Hard</span><span>Soft</span></div>
                </div>
            </div>
        </div>
    `;
    document.getElementById('videoOverlayItems').appendChild(card);

    // Wire up events
    card.querySelector('.btn-remove-video').addEventListener('click', () => removeVideoOverlay(card, idx));
    card.querySelector('.btn-browse-vid').addEventListener('click', async () => {
        const result = await pywebview.api.select_overlay_video();
        if (result) {
            videoOverlayFiles[idx] = result;
            card.querySelector('.vid-overlay-file').value = result.filename;
            card.querySelector('.btn-clear-vid').classList.remove('hidden');
        }
    });
    card.querySelector('.btn-clear-vid').addEventListener('click', () => {
        delete videoOverlayFiles[idx];
        card.querySelector('.vid-overlay-file').value = '';
        card.querySelector('.btn-clear-vid').classList.add('hidden');
    });
    card.querySelector('.vid-overlay-size').addEventListener('input', (e) => {
        card.querySelector('.vid-overlay-size-label').textContent = e.target.value + '%';
        updatePhonePreview();
    });
    card.querySelector('.vid-overlay-opacity').addEventListener('input', (e) => {
        card.querySelector('.vid-overlay-opacity-label').textContent = e.target.value + '%';
        updatePhonePreview();
    });
    card.querySelector('.vid-overlay-position').addEventListener('change', () => updatePhonePreview());

    // Chroma key toggle
    card.querySelector('.vid-overlay-chromakey').addEventListener('change', (e) => {
        card.querySelector('.vid-overlay-chromakey-options').classList.toggle('hidden', !e.target.checked);
        updatePhonePreview();
    });
    card.querySelector('.vid-overlay-chromakey-color').addEventListener('input', (e) => {
        card.querySelector('.vid-overlay-chromakey-color-label').textContent = e.target.value;
    });
    card.querySelector('.vid-overlay-chromakey-similarity').addEventListener('input', (e) => {
        card.querySelector('.vid-overlay-chromakey-similarity-label').textContent = (e.target.value / 10).toFixed(1);
    });
    card.querySelector('.vid-overlay-chromakey-blend').addEventListener('input', (e) => {
        card.querySelector('.vid-overlay-chromakey-blend-label').textContent = (e.target.value / 10).toFixed(1);
    });

    // Link download
    card.querySelector('.btn-vid-link-download').addEventListener('click', () => downloadVideoOverlayFromLink(card, idx));
    card.querySelector('.vid-overlay-link-url').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') downloadVideoOverlayFromLink(card, idx);
    });

    updateOverlayWarnings();
    updatePhonePreview();
}

async function downloadVideoOverlayFromLink(card, idx) {
    const url = card.querySelector('.vid-overlay-link-url').value.trim();
    const source = card.querySelector('.vid-overlay-source').value;
    const config = SOURCE_CONFIG[source];
    if (!config) return;

    if (!url) {
        alert(`Please paste a ${config.label} link first.`);
        return;
    }

    const btn = card.querySelector('.btn-vid-link-download');
    const progressEl = card.querySelector('.vid-overlay-link-progress');
    btn.disabled = true;
    btn.innerHTML = '<div class="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div> Downloading...';
    progressEl.classList.remove('hidden');

    const poll = setInterval(async () => {
        const prog = await pywebview.api[config.progress]();
        if (prog) {
            card.querySelector('.vid-overlay-link-progress-bar').style.width = prog.percent + '%';
            card.querySelector('.vid-overlay-link-progress-percent').textContent = prog.percent + '%';
            const mb = prog.downloaded_mb || 0;
            const total = prog.total_mb ? ` / ${prog.total_mb} MB` : '';
            const statusLabel = prog.status === 'resolving' ? `Resolving ${config.label} link...`
                : prog.status === 'fetching_info' ? 'Fetching video info...'
                : `Downloading... ${mb} MB${total}`;
            card.querySelector('.vid-overlay-link-progress-label').textContent = statusLabel;
        }
    }, 500);

    const info = await pywebview.api[config.api](url);
    clearInterval(poll);

    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined text-base">cloud_download</span> Download';
    progressEl.classList.add('hidden');
    card.querySelector('.vid-overlay-link-progress-bar').style.width = '0%';

    if (info && info.error) {
        alert(`${config.label} Error: ` + info.error);
        return;
    }

    if (info && info.filepath) {
        videoOverlayFiles[idx] = { filepath: info.filepath, filename: info.filename };
        card.querySelector('.vid-overlay-file').value = info.filename;
        card.querySelector('.btn-clear-vid').classList.remove('hidden');
        card.querySelector('.vid-overlay-link-url').value = '';
    }
}

function removeVideoOverlay(card, idx) {
    delete videoOverlayFiles[idx];
    card.remove();
    // Renumber remaining cards
    document.querySelectorAll('#videoOverlayItems > div').forEach((c, i) => {
        c.querySelector('.text-primary').textContent = `Video #${i + 1}`;
    });
    updateOverlayWarnings();
    updatePhonePreview();
}

function getVideoOverlayOptions() {
    const items = document.querySelectorAll('#videoOverlayItems > div');
    if (items.length === 0) return null;
    const overlays = [];
    items.forEach(card => {
        const idx = parseInt(card.dataset.videoIdx);
        const file = videoOverlayFiles[idx];
        if (!file) return;
        const chromakeyEnabled = card.querySelector('.vid-overlay-chromakey').checked;
        const overlay = {
            filepath: file.filepath,
            size_pct: parseInt(card.querySelector('.vid-overlay-size').value),
            position: card.querySelector('.vid-overlay-position').value,
            opacity: parseInt(card.querySelector('.vid-overlay-opacity').value),
            loop: card.querySelector('.vid-overlay-loop').checked,
        };
        if (chromakeyEnabled) {
            overlay.chromakey = {
                color: card.querySelector('.vid-overlay-chromakey-color').value,
                similarity: parseInt(card.querySelector('.vid-overlay-chromakey-similarity').value) / 10,
                blend: parseInt(card.querySelector('.vid-overlay-chromakey-blend').value) / 10,
            };
        }
        overlays.push(overlay);
    });
    return overlays.length > 0 ? overlays : null;
}

// ========================================
// IMAGE OVERLAY (Multiple)
// ========================================
let imageOverlayCounter = 0;
const imageOverlayFiles = {}; // { idx: { filepath, filename, dataUrl? } }

function toggleImageOverlayPanel() {
    const panel = document.getElementById('imageOverlayPanel');
    const chevron = document.getElementById('imageOverlayChevron');
    panel.classList.toggle('collapsed');
    chevron.classList.toggle('rotated');
}

function addImageOverlay() {
    const idx = imageOverlayCounter++;
    const num = document.getElementById('imageOverlayItems').children.length + 1;
    const card = document.createElement('div');
    card.className = 'bg-card rounded-lg border border-white/10 p-3 space-y-3';
    card.dataset.imgIdx = idx;
    card.innerHTML = `
        <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-primary">Image #${num}</span>
            <button class="text-slate-500 hover:text-red-500 transition-colors btn-remove-img" data-idx="${idx}">
                <span class="material-symbols-outlined text-sm">close</span>
            </button>
        </div>
        <div class="flex gap-2">
            <input class="flex-1 bg-black border border-white/10 rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:border-primary focus:ring-1 focus:ring-primary img-overlay-file" placeholder="No image selected (PNG/JPG/WebP)" type="text" readonly/>
            <button class="px-4 py-2.5 bg-card text-slate-200 rounded-lg border border-white/10 hover:bg-white/5 hover:border-primary/30 transition-colors text-sm font-medium btn-browse-img">Browse</button>
            <button class="px-3 py-2.5 text-slate-500 hover:text-red-500 rounded-lg hover:bg-red-500/10 transition-colors hidden btn-clear-img">
                <span class="material-symbols-outlined text-sm">close</span>
            </button>
        </div>
        <div class="grid grid-cols-2 gap-3">
            <div class="space-y-2">
                <div class="flex justify-between items-center">
                    <label class="text-xs font-semibold text-slate-400">Overlay Size</label>
                    <span class="text-primary font-bold text-sm img-overlay-size-label">25%</span>
                </div>
                <input class="w-full h-1.5 bg-black rounded-lg appearance-none cursor-pointer accent-primary img-overlay-size" min="5" max="100" type="range" value="25"/>
                <div class="flex justify-between text-[10px] text-slate-500 font-bold"><span>5%</span><span>100%</span></div>
            </div>
            <div class="space-y-1">
                <label class="text-xs font-semibold text-slate-400">Position</label>
                <select class="w-full bg-black border border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:border-primary focus:ring-1 focus:ring-primary appearance-none img-overlay-position">
                    <option value="top-left">Top Left</option>
                    <option value="top-center">Top Center</option>
                    <option value="top-right">Top Right</option>
                    <option value="center-left">Center Left</option>
                    <option value="center-center">Center Center</option>
                    <option value="center-right">Center Right</option>
                    <option value="bottom-left" selected>Bottom Left</option>
                    <option value="bottom-center">Bottom Center</option>
                    <option value="bottom-right">Bottom Right</option>
                </select>
            </div>
        </div>
        <div class="space-y-2">
            <div class="flex justify-between items-center">
                <label class="text-xs font-semibold text-slate-400">Opacity</label>
                <span class="text-primary font-bold text-sm img-overlay-opacity-label">100%</span>
            </div>
            <input class="w-full h-1.5 bg-black rounded-lg appearance-none cursor-pointer accent-primary img-overlay-opacity" min="10" max="100" type="range" value="100"/>
            <div class="flex justify-between text-[10px] text-slate-500 font-bold"><span>10%</span><span>100%</span></div>
        </div>
        <p class="text-[10px] text-slate-500">Tip: PNG dengan background transparan tampil paling rapi. JPG/WebP juga didukung.</p>
    `;
    document.getElementById('imageOverlayItems').appendChild(card);

    card.querySelector('.btn-remove-img').addEventListener('click', () => removeImageOverlay(card, idx));
    card.querySelector('.btn-browse-img').addEventListener('click', async () => {
        const result = await pywebview.api.select_overlay_image();
        if (result) {
            imageOverlayFiles[idx] = result;
            card.querySelector('.img-overlay-file').value = result.filename;
            card.querySelector('.btn-clear-img').classList.remove('hidden');
            updatePhonePreview();
        }
    });
    card.querySelector('.btn-clear-img').addEventListener('click', () => {
        delete imageOverlayFiles[idx];
        card.querySelector('.img-overlay-file').value = '';
        card.querySelector('.btn-clear-img').classList.add('hidden');
        updatePhonePreview();
    });
    card.querySelector('.img-overlay-size').addEventListener('input', (e) => {
        card.querySelector('.img-overlay-size-label').textContent = e.target.value + '%';
        updatePhonePreview();
    });
    card.querySelector('.img-overlay-opacity').addEventListener('input', (e) => {
        card.querySelector('.img-overlay-opacity-label').textContent = e.target.value + '%';
        updatePhonePreview();
    });
    card.querySelector('.img-overlay-position').addEventListener('change', () => updatePhonePreview());

    updateOverlayWarnings();
    updatePhonePreview();
}

function removeImageOverlay(card, idx) {
    delete imageOverlayFiles[idx];
    card.remove();
    document.querySelectorAll('#imageOverlayItems > div').forEach((c, i) => {
        c.querySelector('.text-primary').textContent = `Image #${i + 1}`;
    });
    updateOverlayWarnings();
    updatePhonePreview();
}

function getImageOverlayOptions() {
    const items = document.querySelectorAll('#imageOverlayItems > div');
    if (items.length === 0) return null;
    const overlays = [];
    items.forEach(card => {
        const idx = parseInt(card.dataset.imgIdx);
        const file = imageOverlayFiles[idx];
        if (!file) return;
        overlays.push({
            filepath: file.filepath,
            size_pct: parseInt(card.querySelector('.img-overlay-size').value),
            position: card.querySelector('.img-overlay-position').value,
            opacity: parseInt(card.querySelector('.img-overlay-opacity').value),
        });
    });
    return overlays.length > 0 ? overlays : null;
}

// ========================================
// HIDE WATERMARK REGION
// ========================================
let watermarkRegionCounter = 0;

const WATERMARK_PRESETS = {
    shopee:           { label: 'Shopee (kiri-tengah)',  x_pct: 0,  y_pct: 46, w_pct: 36, h_pct: 10, method: 'delogo_blur', strength: 8 },
    'tiktok-top':     { label: 'TikTok atas',            x_pct: 30, y_pct: 4,  w_pct: 40, h_pct: 6,  method: 'delogo_blur', strength: 8 },
    'tiktok-bottom':  { label: 'TikTok bawah (@user)',   x_pct: 5,  y_pct: 88, w_pct: 50, h_pct: 8,  method: 'delogo_blur', strength: 8 },
    'ig-top':         { label: 'IG atas',                x_pct: 5,  y_pct: 4,  w_pct: 35, h_pct: 6,  method: 'delogo_blur', strength: 8 },
    'ytshorts-bottom':{ label: 'YT Shorts bawah',        x_pct: 60, y_pct: 90, w_pct: 35, h_pct: 8,  method: 'delogo_blur', strength: 8 },
};

function toggleWatermarkHidePanel() {
    const panel = document.getElementById('watermarkHidePanel');
    const chevron = document.getElementById('watermarkHideChevron');
    panel.classList.toggle('hidden');
    chevron.style.transform = panel.classList.contains('hidden') ? 'rotate(-90deg)' : '';
}

function addWatermarkRegion(presetKey) {
    const preset = presetKey ? WATERMARK_PRESETS[presetKey] : null;
    const x_pct = preset ? preset.x_pct : 0;
    const y_pct = preset ? preset.y_pct : 0;
    const w_pct = preset ? preset.w_pct : 30;
    const h_pct = preset ? preset.h_pct : 8;
    const method = preset ? preset.method : 'delogo_blur';
    const strength = preset ? preset.strength : 8;
    const presetTag = presetKey || '';
    const label = preset ? preset.label : `Region ${document.getElementById('watermarkRegionItems').children.length + 1}`;

    const idx = watermarkRegionCounter++;
    const card = document.createElement('div');
    card.className = 'p-3 bg-card/40 rounded-lg border border-white/5 space-y-2.5';
    card.dataset.wmIdx = idx;
    card.dataset.wmPreset = presetTag;
    card.innerHTML = `
        <div class="flex items-center gap-2">
            <span class="text-[10px] uppercase tracking-wider text-slate-500 font-bold">${label}</span>
            <button class="ml-auto text-slate-500 hover:text-red-400 wm-remove" type="button" title="Remove">
                <span class="material-symbols-outlined text-base">close</span>
            </button>
        </div>
        <div class="grid grid-cols-4 gap-2">
            <label class="text-[10px] text-slate-400">X %
                <input type="number" min="0" max="100" step="1" value="${x_pct}" class="wm-x w-full px-2 py-1 bg-card border border-white/5 rounded text-xs text-white" />
            </label>
            <label class="text-[10px] text-slate-400">Y %
                <input type="number" min="0" max="100" step="1" value="${y_pct}" class="wm-y w-full px-2 py-1 bg-card border border-white/5 rounded text-xs text-white" />
            </label>
            <label class="text-[10px] text-slate-400">W %
                <input type="number" min="1" max="100" step="1" value="${w_pct}" class="wm-w w-full px-2 py-1 bg-card border border-white/5 rounded text-xs text-white" />
            </label>
            <label class="text-[10px] text-slate-400">H %
                <input type="number" min="1" max="100" step="1" value="${h_pct}" class="wm-h w-full px-2 py-1 bg-card border border-white/5 rounded text-xs text-white" />
            </label>
        </div>
        <div class="grid grid-cols-2 gap-2">
            <label class="text-[10px] text-slate-400">Method
                <select class="wm-method w-full px-2 py-1 bg-card border border-white/5 rounded text-xs text-white">
                    <option value="delogo_blur" ${method === 'delogo_blur' ? 'selected' : ''}>Delogo + Blur (rekomendasi)</option>
                    <option value="delogo" ${method === 'delogo' ? 'selected' : ''}>Delogo (in-paint)</option>
                    <option value="blur" ${method === 'blur' ? 'selected' : ''}>Blur (sensor)</option>
                    <option value="cover" ${method === 'cover' ? 'selected' : ''}>Cover (kotak hitam)</option>
                </select>
            </label>
            <label class="text-[10px] text-slate-400">Strength
                <input type="range" min="1" max="30" value="${strength}" class="wm-strength w-full" />
            </label>
        </div>
    `;
    card.querySelector('.wm-remove').addEventListener('click', () => {
        card.remove();
    });
    document.getElementById('watermarkRegionItems').appendChild(card);
}

function getWatermarkHideOptions() {
    const autoShopee = document.getElementById('watermarkAutoShopee').checked;
    const cards = document.querySelectorAll('#watermarkRegionItems > div');
    const regions = [];
    cards.forEach(card => {
        const x_pct = parseFloat(card.querySelector('.wm-x').value) || 0;
        const y_pct = parseFloat(card.querySelector('.wm-y').value) || 0;
        const w_pct = parseFloat(card.querySelector('.wm-w').value) || 0;
        const h_pct = parseFloat(card.querySelector('.wm-h').value) || 0;
        if (w_pct <= 0 || h_pct <= 0) return;
        regions.push({
            x_pct, y_pct, w_pct, h_pct,
            method: card.querySelector('.wm-method').value,
            strength: parseInt(card.querySelector('.wm-strength').value) || 8,
            preset: card.dataset.wmPreset || '',
        });
    });
    if (!autoShopee && regions.length === 0) return null;
    return { enabled: true, auto_shopee: autoShopee, regions };
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

    // Add to multi-source list
    const defaultCount = parseInt(document.getElementById('rangeCloneCount').value) || 10;
    sourceFiles.push({ ...info, cloneCount: defaultCount });

    // Update mode (single vs multi)
    updateSourceMode();

    // Enable start button
    document.getElementById('btnStartClone').disabled = false;

    // Update estimates & preview
    updateEstimates();
    updateTemplatePreview();
}

function updateSourceMode() {
    const fileInfoEl = document.getElementById('fileInfo');
    const sourceListEl = document.getElementById('sourceListSection');
    const sliderLabel = document.getElementById('cloneCountSliderLabel');
    const sliderHint = document.getElementById('cloneCountSliderHint');

    if (sourceFiles.length === 0) {
        fileInfoEl.classList.add('hidden');
        sourceListEl.classList.add('hidden');
        sliderLabel.textContent = 'Clone Count';
        sliderHint.classList.add('hidden');
    } else if (sourceFiles.length === 1) {
        // Single source mode: show file info, hide source list, slider = direct count
        const info = sourceFiles[0];
        fileInfoEl.classList.remove('hidden');
        document.getElementById('infoFilename').textContent = info.filename || '-';
        document.getElementById('infoFilesize').textContent = info.size_mb ? `${info.size_mb} MB` : '-';
        document.getElementById('infoDuration').textContent = info.duration || '-';
        document.getElementById('infoResolution').textContent = info.resolution || '-';
        document.getElementById('infoCodec').textContent = info.video_codec || '-';
        document.getElementById('infoBitrate').textContent = info.bitrate_kbps ? `${info.bitrate_kbps} Kbps` : '-';

        sourceListEl.classList.add('hidden');
        sliderLabel.textContent = 'Clone Count';
        sliderHint.classList.add('hidden');

        // Sync slider with the single source's count
        document.getElementById('rangeCloneCount').value = info.cloneCount;
        document.getElementById('cloneCountLabel').textContent = info.cloneCount;
    } else {
        // Multi source mode: hide file info, show source list with per-source counts
        fileInfoEl.classList.add('hidden');
        sourceListEl.classList.remove('hidden');
        sliderLabel.textContent = 'Default Clones per Source';
        sliderHint.classList.remove('hidden');
        renderSourceList();
    }
}

function clearFile() {
    // In single-source mode, closing file info removes the single source
    if (sourceFiles.length === 1) {
        sourceFiles = [];
    }
    currentFile = null;
    document.getElementById('btnStartClone').disabled = sourceFiles.length === 0;
    document.getElementById('estimateSize').textContent = '-';
    document.getElementById('estimateTime').textContent = '-';
    updateSourceMode();
}

function removeSource(index) {
    sourceFiles.splice(index, 1);
    if (sourceFiles.length > 0) {
        currentFile = sourceFiles[sourceFiles.length - 1];
    } else {
        currentFile = null;
        document.getElementById('btnStartClone').disabled = true;
    }
    updateSourceMode();
    updateEstimates();
}

function clearAllSources() {
    sourceFiles = [];
    currentFile = null;
    document.getElementById('btnStartClone').disabled = true;
    document.getElementById('estimateSize').textContent = '-';
    document.getElementById('estimateTime').textContent = '-';
    updateSourceMode();
}

function updateSourceCloneCount(index, count) {
    if (index >= 0 && index < sourceFiles.length) {
        sourceFiles[index].cloneCount = Math.max(1, Math.min(100, parseInt(count) || 1));
        updateTotalClonesLabel();
        updateEstimates();
    }
}

function updateTotalClonesLabel() {
    const total = sourceFiles.reduce((sum, s) => sum + s.cloneCount, 0);
    const el = document.getElementById('totalClonesLabel');
    if (el) el.textContent = total;
}

function applySourceListCompactState() {
    const container = document.getElementById('sourceListItems');
    const toggleText = document.getElementById('sourceListToggleText');
    const chevron = document.getElementById('sourceListChevron');
    if (!container || !toggleText || !chevron) return;

    container.classList.toggle('hidden', sourceListCollapsed);
    toggleText.textContent = sourceListCollapsed ? 'Expand' : 'Collapse';
    chevron.textContent = sourceListCollapsed ? 'expand_more' : 'expand_less';
}

function toggleSourceListCompact() {
    sourceListCollapsed = !sourceListCollapsed;
    sourceListManualOverride = true;
    applySourceListCompactState();
    pywebview.api.save_config({ source_list_collapsed: sourceListCollapsed }).catch(() => {});
}

function renderSourceList() {
    const section = document.getElementById('sourceListSection');
    const container = document.getElementById('sourceListItems');
    const badge = document.getElementById('sourceCountBadge');

    if (sourceFiles.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    badge.textContent = `(${sourceFiles.length})`;
    updateTotalClonesLabel();

    if (!sourceListManualOverride) {
        sourceListCollapsed = sourceFiles.length > 20;
    }
    applySourceListCompactState();

    container.innerHTML = '';
    sourceFiles.forEach((src, idx) => {
        const sizeNum = typeof src.size_mb === 'number' ? src.size_mb : parseFloat(src.size_mb);
        const sizeText = src.size_mb ? `${src.size_mb} MB` : '-';
        const isLargeDownload = Number.isFinite(sizeNum) && sizeNum > 5;
        const sizeHtml = isLargeDownload
            ? `<span class="text-red-400 font-bold">${escapeHtml(sizeText)}</span>`
            : `<span>${escapeHtml(sizeText)}</span>`;
        const durationText = escapeHtml(src.duration || '-');
        const resolutionText = src.resolution ? ` · ${escapeHtml(String(src.resolution))}` : '';
        const platformBadge = src.source_platform
            ? `<span class="ml-1.5 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/20">${escapeHtml(formatSourcePlatform(src.source_platform))}</span>`
            : '';

        const div = document.createElement('div');
        div.className = 'bg-black/40 rounded-lg border border-white/5 px-2.5 py-2 flex items-center gap-2.5';
        div.innerHTML = `
            <div class="size-7 bg-primary/10 rounded-md flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined text-primary text-xs">videocam</span>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-[11px] font-semibold text-white truncate">${escapeHtml(src.filename || '-')}${platformBadge}</p>
                <p class="text-[10px] text-slate-500 truncate">${sizeHtml} · ${durationText}${resolutionText}</p>
            </div>
            <div class="flex items-center gap-1 shrink-0">
                <label class="text-[10px] text-slate-500">Clones:</label>
                <input type="number" min="1" max="100" value="${src.cloneCount}"
                    class="w-12 bg-black border border-white/10 rounded px-1.5 py-1 text-[11px] text-center text-slate-200 focus:border-primary focus:ring-1 focus:ring-primary"
                    onchange="updateSourceCloneCount(${idx}, this.value)"
                    oninput="updateSourceCloneCount(${idx}, this.value)"/>
            </div>
            <button class="p-1 text-slate-500 hover:text-red-500 transition-colors rounded hover:bg-red-500/10" onclick="removeSource(${idx})" title="Remove source">
                <span class="material-symbols-outlined text-xs">close</span>
            </button>
        `;
        container.appendChild(div);
    });
}

async function resetAll() {
    // Stop cloning if active
    if (isCloning) {
        await pywebview.api.cancel_cloning();
        stopPolling();
        isCloning = false;
    }

    // Clear file & sources
    currentFile = null;
    sourceFiles = [];
    sourceListCollapsed = false;
    sourceListManualOverride = false;
    updateSourceMode();

    // Reset counters
    textOverlayCounter = 0;
    videoOverlayCounter = 0;
    batchCancelled = false;

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

    // Reset Video Effects — uncheck all
    setAllEffects(false);
    document.getElementById('fxWarning').style.display = 'none';

    // Reset BGM
    clearBgmFile();
    document.getElementById('rangeBgmVolume').value = 20;
    document.getElementById('bgmVolumeLabel').textContent = '20%';
    document.getElementById('chkBgmLoop').checked = true;
    document.getElementById('inputBgmLinkUrl').value = '';
    document.getElementById('bgmLinkProgress').classList.add('hidden');
    document.getElementById('bgmLinkProgressBar').style.width = '0%';
    document.getElementById('bgmLinkProgressPercent').textContent = '0%';
    document.getElementById('selectBgmSource').value = 'tiktok';

    // Reset Source Audio
    document.getElementById('selectSourceAudio').value = 'keep';
    document.getElementById('sourceAudioVolumeFields').style.display = 'none';
    document.getElementById('rangeSourceAudioVolume').value = 100;
    document.getElementById('sourceAudioVolumeLabel').textContent = '100%';

    // Reset Text Overlay
    document.getElementById('textOverlayItems').innerHTML = '';
    document.getElementById('textOverlayWarning').classList.add('hidden');

    // Reset Video Overlay
    document.getElementById('videoOverlayItems').innerHTML = '';
    Object.keys(videoOverlayFiles).forEach(k => delete videoOverlayFiles[k]);
    document.getElementById('videoOverlayWarning').classList.add('hidden');

    // Reset Image Overlay
    document.getElementById('imageOverlayItems').innerHTML = '';
    Object.keys(imageOverlayFiles).forEach(k => delete imageOverlayFiles[k]);
    const imgWarn = document.getElementById('imageOverlayWarning');
    if (imgWarn) imgWarn.classList.add('hidden');

    // Reset Hide Watermark Region
    document.getElementById('watermarkRegionItems').innerHTML = '';
    document.getElementById('watermarkAutoShopee').checked = true;
    watermarkRegionCounter = 0;

    // Reset panel collapse states (expand all)
    ['effectsPanel', 'sourceAudioPanel', 'bgmPanel', 'textOverlayPanel', 'videoOverlayPanel', 'watermarkHidePanel', 'previewPanel'].forEach(id => {
        document.getElementById(id).classList.remove('collapsed');
    });
    ['effectsChevron', 'sourceAudioChevron', 'bgmChevron', 'textOverlayChevron', 'videoOverlayChevron', 'watermarkHideChevron', 'previewChevron'].forEach(id => {
        document.getElementById(id).classList.remove('rotated');
    });

    // Reset preview
    updatePhonePreview();

    // Reset single link download area
    document.getElementById('inputLinkUrl').value = '';
    document.getElementById('selectSource').value = 'tiktok';
    updateLinkPlaceholder();
    document.getElementById('linkProgress').classList.add('hidden');
    document.getElementById('linkProgressBar').style.width = '0%';
    document.getElementById('linkProgressPercent').textContent = '0%';

    // Reset batch link download area
    setLinkMode('single');
    document.getElementById('inputBatchLinks').value = '';
    document.getElementById('batchLinkCount').textContent = '0';
    document.getElementById('batchProgressList').innerHTML = '';
    document.getElementById('batchProgressList').classList.add('hidden');

    // Reset FB scraper
    document.getElementById('inputFbPageUrl').value = '';
    document.getElementById('fbScrapeResults').classList.add('hidden');
    document.getElementById('fbScrapeList').innerHTML = '';

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
    shopee:   { label: 'Shopee',           placeholder: 'Paste Shopee video link (e.g. https://id.shp.ee/...)...',  api: 'download_from_shopee',   progress: 'get_shopee_download_progress' },
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
// BATCH LINK DOWNLOAD
// ========================================

function setLinkMode(mode) {
    const btnSingle = document.getElementById('btnModeSingle');
    const btnBatch = document.getElementById('btnModeBatch');
    const singleMode = document.getElementById('singleLinkMode');
    const batchMode = document.getElementById('batchLinkMode');

    if (mode === 'batch') {
        btnSingle.className = 'px-3 py-1 text-xs font-bold rounded-md transition-all text-slate-400 hover:text-slate-200';
        btnBatch.className = 'px-3 py-1 text-xs font-bold rounded-md transition-all bg-primary/20 text-primary border border-primary/30';
        singleMode.classList.add('hidden');
        batchMode.classList.remove('hidden');
    } else {
        btnSingle.className = 'px-3 py-1 text-xs font-bold rounded-md transition-all bg-primary/20 text-primary border border-primary/30';
        btnBatch.className = 'px-3 py-1 text-xs font-bold rounded-md transition-all text-slate-400 hover:text-slate-200';
        singleMode.classList.remove('hidden');
        batchMode.classList.add('hidden');
    }
}

// ========================================
// FB REELS SCRAPER
// ========================================

async function scrapeFbReels() {
    const url = document.getElementById('inputFbPageUrl').value.trim();
    if (!url) {
        alert('Please paste a Facebook page reels URL first.');
        return;
    }

    const limitVal = parseInt(document.getElementById('inputFbScrapeLimit').value, 10);
    const limit = Number.isFinite(limitVal) && limitVal > 0 ? limitVal : 0;
    const scrollVal = parseInt(document.getElementById('inputFbScrollCount').value, 10);
    const scrollCount = Number.isFinite(scrollVal) ? Math.max(1, Math.min(scrollVal, 50)) : 5;
    const order = document.getElementById('selectFbScrapeOrder').value === 'desc' ? 'desc' : 'asc';

    const btn = document.getElementById('btnScrapeFbReels');
    const resultsEl = document.getElementById('fbScrapeResults');
    const listEl = document.getElementById('fbScrapeList');

    btn.disabled = true;
    btn.innerHTML = '<div class="size-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div> Scrolling...';

    const result = await pywebview.api.scrape_fb_reels(url, limit, scrollCount, order);

    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined text-sm">search</span> Scrape';
    checkFbLoginStatus();

    if (result && result.error) {
        alert('Scrape Error: ' + result.error);
        return;
    }

    if (result && result.links && result.links.length > 0) {
        document.getElementById('fbScrapeCount').textContent = result.count;
        
        // Render compact summary view with numbering
        const summaryEl = document.getElementById('fbScrapeSummary');
        summaryEl.innerHTML = '';
        result.links.slice(0, 30).forEach((link, i) => {
            const btn = document.createElement('label');
            btn.className = 'text-[9px] font-bold text-slate-300 bg-black/50 border border-blue-500/30 rounded py-1 px-1 hover:bg-blue-600/20 hover:border-blue-400/50 transition-all cursor-pointer flex items-center justify-center';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'fb-scrape-chk';
            checkbox.value = link;
            checkbox.checked = true;
            checkbox.style.marginRight = '4px';
            const span = document.createElement('span');
            span.textContent = `#${i + 1}`;
            btn.appendChild(checkbox);
            btn.appendChild(span);
            summaryEl.appendChild(btn);
        });
        
        // Add "and more" indicator if > 30
        if (result.links.length > 30) {
            const moreBtn = document.createElement('div');
            moreBtn.className = 'text-[9px] text-slate-500 bg-black/30 border border-white/10 rounded py-1 px-1 text-center font-bold';
            moreBtn.textContent = `+${result.links.length - 30} more`;
            summaryEl.appendChild(moreBtn);
        }
        
        // Render full list for details view
        const listEl = document.getElementById('fbScrapeList');
        listEl.innerHTML = '';
        result.links.forEach((link, i) => {
            const row = document.createElement('label');
            row.className = 'flex items-center gap-2 bg-black/40 rounded px-2 py-1 border border-white/5 cursor-pointer hover:border-blue-500/30 transition-colors';
            row.innerHTML = `<input type="checkbox" checked class="fb-scrape-chk accent-blue-500 shrink-0" value="${link}"/>
                <span class="text-[10px] text-slate-500 shrink-0">#${i + 1}</span>
                <span class="text-[10px] text-slate-300 truncate flex-1" title="${link}">${link}</span>`;
            listEl.appendChild(row);
        });
        
        // Setup toggle button
        const toggleBtn = document.getElementById('btnToggleFbDetails');
        const detailsContainer = document.getElementById('fbScrapeDetailsContainer');
        toggleBtn.onclick = () => {
            detailsContainer.classList.toggle('hidden');
            toggleBtn.innerHTML = detailsContainer.classList.contains('hidden') 
                ? '<span class="material-symbols-outlined text-sm align-middle">expand_more</span>'
                : '<span class="material-symbols-outlined text-sm align-middle">expand_less</span>';
        };
        
        resultsEl.classList.remove('hidden');
    }
}

function fbScrapeSelectAll(checked) {
    document.querySelectorAll('#fbScrapeList .fb-scrape-chk').forEach(chk => { chk.checked = checked; });
}

function fbAddSelectedToBatch() {
    const selected = [];
    document.querySelectorAll('#fbScrapeList .fb-scrape-chk:checked').forEach(chk => {
        selected.push(chk.value);
    });

    if (selected.length === 0) {
        alert('No links selected.');
        return;
    }

    const textarea = document.getElementById('inputBatchLinks');
    const existingLines = textarea.value
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
    const merged = Array.from(new Set([...existingLines, ...selected]));
    textarea.value = merged.join('\n');
    updateBatchLinkCount();

    // Clear scrape results
    document.getElementById('fbScrapeResults').classList.add('hidden');
    document.getElementById('fbScrapeList').innerHTML = '';
    document.getElementById('inputFbPageUrl').value = '';
}

async function checkFbLoginStatus() {
    try {
        const res = await pywebview.api.fb_check_login();
        const dot = document.getElementById('fbLoginDot');
        const btnLogin = document.getElementById('btnFbLogin');
        const btnLogout = document.getElementById('btnFbLogout');
        const hint = document.getElementById('fbLoginHint');
        if (res && res.logged_in) {
            dot.className = 'size-2 rounded-full bg-green-500';
            btnLogin.classList.add('hidden');
            btnLogout.classList.remove('hidden');
            hint.classList.add('hidden');
        } else {
            dot.className = 'size-2 rounded-full bg-red-500';
            btnLogin.classList.remove('hidden');
            btnLogout.classList.add('hidden');
            hint.classList.remove('hidden');
        }
    } catch(e) {}
}

async function fbLogin() {
    const btn = document.getElementById('btnFbLogin');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined text-[12px] animate-spin">progress_activity</span> Opening...';
    try {
        const res = await pywebview.api.fb_login();
        if (res && res.error) {
            alert(res.error);
        } else {
            alert('Chrome window opened. Login to Facebook, then the window will close automatically.\n\nAfter login, click Scrape again.');
            // Poll for login completion
            const poll = setInterval(async () => {
                const status = await pywebview.api.fb_check_login();
                if (status && status.logged_in) {
                    clearInterval(poll);
                    checkFbLoginStatus();
                }
            }, 3000);
            setTimeout(() => clearInterval(poll), 320000);
        }
    } catch(e) {
        alert('Failed to open login window: ' + e);
    }
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined text-[12px]">login</span> Login FB';
}

async function fbLogout() {
    if (!confirm('Logout dari Facebook? Session scraping akan dihapus.')) return;
    await pywebview.api.fb_logout();
    checkFbLoginStatus();
}

function detectSourceFromUrl(url) {
    url = url.toLowerCase();
    if (url.includes('tiktok.com')) return 'tiktok';
    if (url.includes('instagram.com')) return 'reels';
    if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com')) return 'fbreels';
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'ytshorts';
    if (url.includes('shp.ee') || /(^|\.)shopee\.[a-z.]+/i.test(url)) return 'shopee';
    if (url.includes('drive.google.com')) return 'gdrive';
    return null;
}

function parseBatchLinks() {
    const text = document.getElementById('inputBatchLinks').value;
    return text.split('\n').map(l => l.trim()).filter(l => l && (l.startsWith('http://') || l.startsWith('https://')));
}

function updateBatchLinkCount() {
    const links = parseBatchLinks();
    document.getElementById('batchLinkCount').textContent = links.length;
}

let batchCancelled = false;

async function batchDownloadFromLinks() {
    const links = Array.from(new Set(parseBatchLinks()));
    if (links.length === 0) {
        alert('No valid links found. Paste one URL per line.');
        return;
    }

    batchCancelled = false;
    const btn = document.getElementById('btnBatchDownload');
    const listEl = document.getElementById('batchProgressList');
    listEl.classList.remove('hidden');
    listEl.innerHTML = `
        <div class="bg-black/60 border border-white/10 rounded-lg p-3 space-y-2">
            <div class="flex items-center justify-between gap-3">
                <p class="text-xs text-slate-300 font-semibold">Batch Download Progress</p>
                <p class="text-xs text-primary font-bold" id="batchCompactRatio">0/0</p>
            </div>
            <div class="h-1.5 bg-black rounded-full overflow-hidden border border-white/5">
                <div class="h-full bg-primary transition-all duration-300" id="batchCompactBar" style="width:0%"></div>
            </div>
            <div class="grid grid-cols-4 gap-1.5 text-[10px]">
                <div class="bg-black/50 rounded px-2 py-1 border border-white/10 text-slate-400">Total <span class="font-bold text-slate-300" id="batchCompactTotal">0</span></div>
                <div class="bg-black/50 rounded px-2 py-1 border border-white/10 text-blue-300">Running <span class="font-bold" id="batchCompactRunning">0</span></div>
                <div class="bg-black/50 rounded px-2 py-1 border border-white/10 text-green-300">Done <span class="font-bold" id="batchCompactSuccess">0</span></div>
                <div class="bg-black/50 rounded px-2 py-1 border border-white/10 text-red-300">Fail <span class="font-bold" id="batchCompactFail">0</span></div>
            </div>
            <div class="text-[10px] text-slate-500 truncate" id="batchCompactCurrent">Waiting to start...</div>
            <div class="flex items-center justify-between gap-2 text-[10px]">
                <button class="px-2 py-1 rounded border border-white/10 text-slate-300 hover:text-white hover:border-white/20 transition-all" id="batchToggleDetails">Show Details</button>
                <label class="flex items-center gap-1.5 text-slate-400">
                    <input type="checkbox" class="accent-primary" id="batchAutoHide" ${batchAutoHidePreference ? 'checked' : ''}/>
                    Auto-hide after complete
                </label>
            </div>
            <div class="space-y-1 max-h-28 overflow-y-auto" id="batchCompactLog"></div>
            <div class="hidden space-y-1 max-h-40 overflow-y-auto border border-white/10 rounded p-2 bg-black/40" id="batchCompactDetails"></div>
        </div>`;

    const ratioEl = document.getElementById('batchCompactRatio');
    const barEl = document.getElementById('batchCompactBar');
    const totalEl = document.getElementById('batchCompactTotal');
    const runningEl = document.getElementById('batchCompactRunning');
    const successEl = document.getElementById('batchCompactSuccess');
    const failEl = document.getElementById('batchCompactFail');
    const currentEl = document.getElementById('batchCompactCurrent');
    const logEl = document.getElementById('batchCompactLog');
    const detailsEl = document.getElementById('batchCompactDetails');
    const detailsToggleEl = document.getElementById('batchToggleDetails');
    const autoHideEl = document.getElementById('batchAutoHide');

    detailsToggleEl.onclick = () => {
        detailsEl.classList.toggle('hidden');
        detailsToggleEl.textContent = detailsEl.classList.contains('hidden') ? 'Show Details' : 'Hide Details';
    };

    autoHideEl.onchange = async () => {
        batchAutoHidePreference = autoHideEl.checked;
        try {
            await pywebview.api.save_config({ default_batch_auto_hide: batchAutoHidePreference });
        } catch (e) {
            // Keep running even when persisting settings fails.
        }
    };

    const pushCompactLog = (icon, textClass, text) => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2 bg-black/40 rounded px-2 py-1 border border-white/5';
        row.innerHTML = `<span class="material-symbols-outlined text-xs ${icon.color}">${icon.name}</span>
            <span class="text-[10px] ${textClass} truncate" title="${text}">${text}</span>`;
        logEl.prepend(row);
        while (logEl.childElementCount > 8) {
            logEl.removeChild(logEl.lastElementChild);
        }
    };

    const updateCompact = (state) => {
        const finished = state.success + state.fail;
        const percent = state.total > 0 ? Math.round((finished / state.total) * 100) : 0;
        ratioEl.textContent = `${finished}/${state.total}`;
        barEl.style.width = `${percent}%`;
        totalEl.textContent = String(state.total);
        runningEl.textContent = String(state.running);
        successEl.textContent = String(state.success);
        failEl.textContent = String(state.fail);
        currentEl.textContent = state.current || 'Waiting to start...';
    };

    const detailRows = [];
    const createDetailRow = (idx, url, label) => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2 bg-black/50 rounded px-2 py-1 border border-white/5';
        row.innerHTML = `<span class="text-[10px] text-slate-500 shrink-0">#${idx}</span>
            <span class="material-symbols-outlined text-xs text-slate-500 batch-detail-icon">hourglass_empty</span>
            <span class="text-[10px] text-slate-400 truncate flex-1" title="${url}">${url}</span>
            <span class="text-[10px] text-slate-500 font-bold shrink-0 batch-detail-status">${label} · Pending</span>`;
        detailsEl.appendChild(row);
        const refs = {
            row,
            iconEl: row.querySelector('.batch-detail-icon'),
            statusEl: row.querySelector('.batch-detail-status')
        };
        detailRows.push(refs);
        return refs;
    };

    // Build items with auto-detected sources
    const items = [];
    let unknownCount = 0;
    for (let idx = 0; idx < links.length; idx++) {
        const url = links[idx];
        const source = detectSourceFromUrl(url);
        if (!source) {
            unknownCount++;
            pushCompactLog({ name: 'error', color: 'text-red-500' }, 'text-red-300', `Unknown platform: ${url}`);
            const detail = createDetailRow(idx + 1, url, 'Unknown');
            detail.iconEl.textContent = 'error';
            detail.iconEl.className = 'material-symbols-outlined text-xs text-red-500 batch-detail-icon';
            detail.statusEl.textContent = 'Unknown platform';
            detail.statusEl.className = 'text-[10px] text-red-300 font-bold shrink-0 batch-detail-status';
            continue;
        }
        const config = SOURCE_CONFIG[source];
        const detail = createDetailRow(idx + 1, url, config.label);
        items.push({ url, source, config, detail });
    }

    if (items.length === 0) {
        alert('No recognized platform links found.');
        return;
    }

    const compactState = {
        total: links.length,
        running: 0,
        success: 0,
        fail: unknownCount,
        current: 'Starting...'
    };
    updateCompact(compactState);

    btn.disabled = true;
    btn.innerHTML = '<div class="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div> Downloading...';

    let successCount = 0;
    let failCount = unknownCount;

    for (let i = 0; i < items.length; i++) {
        if (batchCancelled) break;
        const { url, source, config, detail } = items[i];
        compactState.running = 1;
        compactState.current = `${config.label} · Downloading (${i + 1}/${items.length})`;
        updateCompact(compactState);
        btn.innerHTML = `<div class="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div> ${i + 1}/${items.length}`;

        detail.iconEl.textContent = 'downloading';
        detail.iconEl.className = 'material-symbols-outlined text-xs text-primary batch-detail-icon animate-pulse';
        detail.statusEl.textContent = `${config.label} · Downloading...`;
        detail.statusEl.className = 'text-[10px] text-primary font-bold shrink-0 batch-detail-status';

        // Poll progress
        const poll = setInterval(async () => {
            const prog = await pywebview.api[config.progress]();
            if (prog) {
                const mb = prog.downloaded_mb || 0;
                const total = prog.total_mb ? ` / ${prog.total_mb} MB` : '';
                const statusLabel = prog.status === 'resolving' ? 'Resolving...'
                    : prog.status === 'fetching_info' ? 'Fetching info...'
                    : `${prog.percent}% · ${mb} MB${total}`;
                compactState.current = `${config.label} · ${statusLabel}`;
                updateCompact(compactState);
                detail.statusEl.textContent = `${config.label} · ${statusLabel}`;
            }
        }, 500);

        const info = await pywebview.api[config.api](url);
        clearInterval(poll);

        if (info && info.error) {
            failCount++;
            compactState.fail = failCount;
            pushCompactLog({ name: 'error', color: 'text-red-500' }, 'text-red-300', `${config.label}: ${info.error}`);
            detail.iconEl.textContent = 'error';
            detail.iconEl.className = 'material-symbols-outlined text-xs text-red-500 batch-detail-icon';
            detail.statusEl.textContent = `${config.label} · Failed`;
            detail.statusEl.className = 'text-[10px] text-red-300 font-bold shrink-0 batch-detail-status';
        } else if (info) {
            onFileSelected(info);
            successCount++;
            compactState.success = successCount;
            pushCompactLog({ name: 'check_circle', color: 'text-green-500' }, 'text-green-300', `${config.label}: Done (${i + 1}/${items.length})`);
            detail.iconEl.textContent = 'check_circle';
            detail.iconEl.className = 'material-symbols-outlined text-xs text-green-500 batch-detail-icon';
            detail.statusEl.textContent = `${config.label} · Done`;
            detail.statusEl.className = 'text-[10px] text-green-300 font-bold shrink-0 batch-detail-status';
        }

        compactState.running = 0;
        updateCompact(compactState);
    }

    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined text-base">cloud_download</span> Download All';

    if (successCount > 0) {
        document.getElementById('inputBatchLinks').value = '';
        updateBatchLinkCount();
    }

    compactState.running = 0;
    compactState.current = batchCancelled ? 'Batch cancelled.' : 'Batch finished.';
    updateCompact(compactState);

    if (batchAutoHidePreference) {
        setTimeout(() => {
            listEl.classList.add('hidden');
        }, 2500);
    }

    const msg = batchCancelled ? `Batch cancelled. ${successCount} downloaded, ${failCount} failed.`
        : `Batch complete! ${successCount} downloaded` + (failCount > 0 ? `, ${failCount} failed.` : '.');
    alert(msg);
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
    if (sourceFiles.length === 0 || isCloning) return;

    const effects = getSelectedEffects();
    const bgmOptions = getBgmOptions();
    const textOverlays = getTextOverlayOptions();
    const videoOverlays = getVideoOverlayOptions();
    const imageOverlays = getImageOverlayOptions();

    const sources = sourceFiles.map(s => ({
        filepath: s.filepath,
        count: s.cloneCount,
        source_platform: s.source_platform || null,
    }));

    const options = {
        sources: sources,
        method: document.getElementById('selectMethod').value,
        quality: document.getElementById('selectQuality').value,
        format: document.getElementById('selectFormat').value,
        output_folder: outputFolder || '',
        template: document.getElementById('inputTemplate').value,
        effects: effects,
        bgm: bgmOptions,
        source_audio: getSourceAudioOptions(),
        text_overlays: textOverlays,
        video_overlays: videoOverlays,
        image_overlays: imageOverlays,
        watermark_hide: getWatermarkHideOptions(),
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
    const stage = data.stage || 'cloning';
    const ppTotal = data.preprocess_total || 0;
    const ppIndex = data.preprocess_index || 0;

    // Progress bar — during pre-pass, show pre-pass progress instead of 0%
    let percent = data.percent || 0;
    if (stage === 'preprocessing' && ppTotal > 0) {
        percent = Math.round((ppIndex / ppTotal) * 100);
    }
    document.getElementById('progressBar').style.width = percent + '%';
    document.getElementById('progressPercent').textContent = percent + '%';

    // Counter
    const doneCount = data.items ? data.items.filter(i => i.status === 'done').length : 0;
    if (stage === 'preprocessing' && ppTotal > 0) {
        document.getElementById('taskCounter').textContent = `${ppIndex}/${ppTotal}`;
    } else {
        document.getElementById('taskCounter').textContent = `${doneCount}/${data.total}`;
    }

    // Label
    if (data.status === 'running') {
        if (stage === 'preprocessing' && ppTotal > 0) {
            document.getElementById('progressLabel').textContent =
                `Preprocessing watermark... ${ppIndex}/${ppTotal}`;
        } else {
            document.getElementById('progressLabel').textContent = `Processing clone #${data.current_index}...`;
        }
    }

    // Remaining
    if (stage !== 'preprocessing' && data.estimated_remaining > 0) {
        document.getElementById('progressRemaining').textContent = `~${Math.round(data.estimated_remaining)}s remaining`;
    } else if (stage === 'preprocessing' && ppTotal > 0) {
        document.getElementById('progressRemaining').textContent =
            `Hiding watermark on ${ppTotal} source${ppTotal === 1 ? '' : 's'} before cloning starts`;
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
    if (sourceFiles.length === 0) return;

    const method = document.getElementById('selectMethod').value;

    // Size estimate: sum of (each source size × its clone count)
    let totalSize = 0;
    let totalClones = 0;
    sourceFiles.forEach(src => {
        totalSize += (src.size_mb || 0) * src.cloneCount;
        totalClones += src.cloneCount;
    });
    totalSize = totalSize.toFixed(1);

    document.getElementById('estimateSize').textContent = totalSize >= 1024
        ? `${(totalSize / 1024).toFixed(1)} GB`
        : `${totalSize} MB`;

    // Time estimate
    const perClone = method === 'fast' ? 4 : 15;
    const totalSec = perClone * totalClones;
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
    const title = (currentFile || sourceFiles[0]) ? (currentFile || sourceFiles[0]).filename.replace(/\.[^/.]+$/, '') : 'my_video';
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
    document.getElementById('rangeCloneCount').value = config.default_clone_count || 1;
    document.getElementById('cloneCountLabel').textContent = config.default_clone_count || 1;
    document.getElementById('selectFormat').value = config.default_format || 'mp4';
    document.getElementById('selectMethod').value = config.default_method || 'standard';
    document.getElementById('selectQuality').value = config.default_quality || '1080p';
    document.getElementById('qualityWarning').style.display = 'none';
    document.getElementById('inputTemplate').value = config.default_template || '{index}';

    outputFolder = config.default_output_folder || '';
    batchAutoHidePreference = config.default_batch_auto_hide !== false;
    if (typeof config.source_list_collapsed === 'boolean') {
        sourceListCollapsed = config.source_list_collapsed;
        sourceListManualOverride = true;
    } else {
        sourceListCollapsed = false;
        sourceListManualOverride = false;
    }
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
    document.getElementById('settingsCloneCount').value = config.default_clone_count || 1;
    document.getElementById('settingsFormat').value = config.default_format || 'mp4';
    document.getElementById('settingsTemplate').value = config.default_template || '{index}';

    // Toggles
    setToggle(document.getElementById('togglePopup'), config.notify_popup !== false);
    setToggle(document.getElementById('toggleSound'), config.notify_sound !== false);
    setToggle(document.getElementById('toggleBatchAutoHide'), config.default_batch_auto_hide !== false);
    setToggle(document.getElementById('toggleSourceListCollapsed'), config.source_list_collapsed === true);

    // Apply current compact state immediately when source list is visible.
    applySourceListCompactState();
}

async function saveSettings() {
    const autoHideFromSettings = document.getElementById('toggleBatchAutoHide').classList.contains('bg-primary');
    const sourceListCollapsedFromSettings = document.getElementById('toggleSourceListCollapsed').classList.contains('bg-primary');
    batchAutoHidePreference = autoHideFromSettings;
    sourceListCollapsed = sourceListCollapsedFromSettings;
    sourceListManualOverride = true;

    const config = {
        ffmpeg_path: document.getElementById('settingsFFmpegPath').value,
        default_clone_count: parseInt(document.getElementById('settingsCloneCount').value) || 10,
        default_format: document.getElementById('settingsFormat').value,
        default_template: document.getElementById('settingsTemplate').value,
        default_batch_auto_hide: autoHideFromSettings,
        source_list_collapsed: sourceListCollapsedFromSettings,
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

const SOURCE_PLATFORM_LABELS = {
    tiktok: 'TikTok',
    reels: 'IG Reels',
    fbreels: 'FB Reels',
    ytshorts: 'YT Shorts',
    shopee: 'Shopee',
    gdrive: 'GDrive',
};

function formatSourcePlatform(key) {
    return SOURCE_PLATFORM_LABELS[key] || String(key || '');
}

// ========================================
// OVERLAY PREVIEW (Phone Frame)
// ========================================
const POSITION_STYLES = {
    'top-left':       { top: '6%', left: '5%' },
    'top-center':     { top: '6%', left: '50%', transform: 'translateX(-50%)' },
    'top-right':      { top: '6%', right: '5%' },
    'center-left':    { top: '50%', left: '5%', transform: 'translateY(-50%)' },
    'center-center':  { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
    'center-right':   { top: '50%', right: '5%', transform: 'translateY(-50%)' },
    'center':         { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
    'bottom-left':    { bottom: '6%', left: '5%' },
    'bottom-center':  { bottom: '6%', left: '50%', transform: 'translateX(-50%)' },
    'bottom-right':   { bottom: '6%', right: '5%' },
};

const PIP_POSITION_STYLES = {
    'top-left':      { top: '4%', left: '4%' },
    'top-center':    { top: '4%', left: '50%', transform: 'translateX(-50%)' },
    'top-right':     { top: '4%', right: '4%' },
    'center-left':   { top: '50%', left: '4%', transform: 'translateY(-50%)' },
    'center-center': { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
    'center-right':  { top: '50%', right: '4%', transform: 'translateY(-50%)' },
    'center':        { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
    'bottom-left':   { bottom: '4%', left: '4%' },
    'bottom-center': { bottom: '4%', left: '50%', transform: 'translateX(-50%)' },
    'bottom-right':  { bottom: '4%', right: '4%' },
};

function updatePhonePreview() {
    const screen = document.getElementById('phoneScreen');
    if (!screen) return;

    // Remove old overlay indicators
    screen.querySelectorAll('.phone-text-overlay, .phone-video-overlay, .phone-image-overlay').forEach(el => el.remove());

    let hasOverlays = false;

    // --- Text Overlays ---
    document.querySelectorAll('#textOverlayItems > div').forEach((card, i) => {
        const text = card.querySelector('.txt-overlay-text').value.trim();
        if (!text) return;
        hasOverlays = true;

        const fontSize = parseInt(card.querySelector('.txt-overlay-size').value);
        const position = card.querySelector('.txt-overlay-position').value;
        const color = card.querySelector('.txt-overlay-color').value;
        const fontFile = card.querySelector('.txt-overlay-font').value;
        const fontFamily = FONT_FAMILY_MAP[fontFile] || 'Arial';

        const el = document.createElement('div');
        el.className = 'phone-text-overlay';

        // Scale font size: source ~24px on a 1080 video -> preview ~8px on 188px screen
        const scaledSize = Math.max(6, Math.round(fontSize * 0.33));
        el.style.fontSize = scaledSize + 'px';
        el.style.color = color;
        el.style.fontFamily = fontFamily + ', sans-serif';

        const pos = POSITION_STYLES[position] || POSITION_STYLES['bottom-left'];
        Object.assign(el.style, { top: '', bottom: '', left: '', right: '', transform: '' });
        Object.assign(el.style, pos);

        el.textContent = text;
        screen.appendChild(el);
    });

    // --- Video Overlays ---
    document.querySelectorAll('#videoOverlayItems > div').forEach((card, i) => {
        hasOverlays = true;

        const sizePct = parseInt(card.querySelector('.vid-overlay-size').value);
        const position = card.querySelector('.vid-overlay-position').value;
        const opacity = parseInt(card.querySelector('.vid-overlay-opacity').value);

        const el = document.createElement('div');
        el.className = 'phone-video-overlay';
        el.style.width = sizePct + '%';
        el.style.aspectRatio = '9 / 16';
        el.style.opacity = opacity / 100;

        const pos = PIP_POSITION_STYLES[position] || PIP_POSITION_STYLES['bottom-left'];
        Object.assign(el.style, { top: '', bottom: '', left: '', right: '', transform: '' });
        Object.assign(el.style, pos);

        const isChromakey = card.querySelector('.vid-overlay-chromakey').checked;
        const ckIcon = isChromakey ? 'auto_fix_high' : 'videocam';
        const ckLabel = isChromakey ? 'GS' : 'PiP';
        if (isChromakey) el.style.border = '2px dashed #00ff0088';
        el.innerHTML = `<div style="text-align:center"><span class="material-symbols-outlined phone-video-overlay-icon">${ckIcon}</span><div class="phone-video-overlay-label">${ckLabel} #${i + 1}<br>${sizePct}%</div></div>`;
        screen.appendChild(el);
    });

    // --- Image Overlays ---
    document.querySelectorAll('#imageOverlayItems > div').forEach((card, i) => {
        const idx = parseInt(card.dataset.imgIdx);
        const file = imageOverlayFiles[idx];
        if (!file) return;
        hasOverlays = true;

        const sizePct = parseInt(card.querySelector('.img-overlay-size').value);
        const position = card.querySelector('.img-overlay-position').value;
        const opacity = parseInt(card.querySelector('.img-overlay-opacity').value);

        const el = document.createElement('div');
        el.className = 'phone-image-overlay phone-video-overlay';
        el.style.width = sizePct + '%';
        el.style.aspectRatio = '1 / 1';
        el.style.opacity = opacity / 100;
        el.style.border = '2px dashed #f59e0b88';

        const pos = PIP_POSITION_STYLES[position] || PIP_POSITION_STYLES['bottom-left'];
        Object.assign(el.style, { top: '', bottom: '', left: '', right: '', transform: '' });
        Object.assign(el.style, pos);

        el.innerHTML = `<div style="text-align:center"><span class="material-symbols-outlined phone-video-overlay-icon">image</span><div class="phone-video-overlay-label">IMG #${i + 1}<br>${sizePct}%</div></div>`;
        screen.appendChild(el);
    });

    // Toggle empty hint
    const hint = document.getElementById('phoneEmptyHint');
    if (hint) hint.style.display = hasOverlays ? 'none' : 'flex';
}
