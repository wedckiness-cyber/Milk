/**
 * 观影阅读记录（最终完整版）
 * - 空状态不扁塌
 * - 折叠功能正常
 * - 筛选按钮高亮
 * - 梦角点评延时10~60分钟，按钮常态暗，排队后亮
 * - 移除“在看”，只保留“想看”“已看”
 * - 豆瓣式布局
 */
let watchlistData = [];
let watchFilter = 'all';
const watchExecuting = new Set();

// ========== 数据加载与保存 ==========
async function loadWatchlistData() {
    try {
        const data = await localforage.getItem(getStorageKey('watchlist'));
        watchlistData = data || [];
        watchlistData.forEach(item => {
            if (!item.comments) item.comments = [];
            if (item.status !== '已看' && item.status !== '想看') {
                item.status = '想看'; // 修正旧数据
            }
        });
    } catch (e) {
        watchlistData = [];
    }
}

async function saveWatchlistData() {
    const normalized = watchlistData.map(item => ({
        title: item.title,
        type: item.type,
        status: item.status,
        rating: item.rating,
        note: item.note,
        createdAt: item.createdAt,
        comments: item.comments || []
    }));
    await localforage.setItem(getStorageKey('watchlist'), normalized);
    watchlistData = normalized;
}

// ========== 定时任务 ==========
function getSchedKey() { return getStorageKey('scheduledWatchComments'); }
async function loadSched() { return (await localforage.getItem(getSchedKey())) || []; }
async function saveSched(tasks) { await localforage.setItem(getSchedKey(), tasks); }

async function scheduleWatchComment(itemIndex) {
    const tasks = await loadSched();
    if (tasks.some(t => t.type === 'watchlist' && t.itemIndex === itemIndex)) {
        showNotification('梦角的点评已经在排着队啦～', 'info');
        return;
    }
    const replies = (typeof customReplies !== 'undefined' && customReplies.length > 0)
        ? customReplies : ['这个我也喜欢！', '我也想看看！', '推荐得好～'];

    // 随机抽取 1~3 条不同字卡，合并为一条消息
    const drawCount = Math.min(replies.length, Math.floor(Math.random() * 3) + 1);
    const shuffled = [...replies].sort(() => Math.random() - 0.5);
    const selectedTexts = shuffled.slice(0, drawCount);
    const combinedText = selectedTexts.join(' ');  // 用空格拼接，也可换成 '｜' 或 '\n'

    const delay = 600000 + Math.random() * 3000000; // 10~60分钟
    const executeTime = Date.now() + delay;
    const newTask = {
        type: 'watchlist',
        itemIndex,
        executeTime,
        text: combinedText   // 字符串，不是数组
    };
    tasks.push(newTask);
    await saveSched(tasks);
    setTimeout(() => executeWatchTask(newTask), delay);
    renderWatchlist();
    showNotification('梦角的点评已排队，将在10分钟~1小时内送达 ✨', 'success');
}

async function executeWatchTask(task) {
    const key = `watch_${task.itemIndex}`;
    if (watchExecuting.has(key)) return;
    watchExecuting.add(key);
    try {
        await loadWatchlistData();
        const tasks = await loadSched();
        const idx = tasks.findIndex(t => t.type === 'watchlist' && t.itemIndex === task.itemIndex);
        if (idx === -1) return;
        if (watchlistData[task.itemIndex]) {
            if (!watchlistData[task.itemIndex].comments) watchlistData[task.itemIndex].comments = [];
            // 兼容旧数据：如果是数组则拼接，否则直接用字符串
            const commentText = Array.isArray(task.texts) 
                ? task.texts.join(' ') 
                : (task.text || '');
            watchlistData[task.itemIndex].comments.push({
                text: commentText,
                time: Date.now()
            });
            await saveWatchlistData();
            renderWatchlist();
            showNotification(`「${watchlistData[task.itemIndex].title}」收到了梦角的点评 ✨`, 'success');
        }
        tasks.splice(idx, 1);
        await saveSched(tasks);
    } finally {
        watchExecuting.delete(key);
    }
}

async function restoreSched() {
    const tasks = await loadSched();
    const now = Date.now();
    const remaining = [];
    for (const task of tasks) {
        if (task.type !== 'watchlist') { remaining.push(task); continue; }
        if (task.executeTime <= now) await executeWatchTask(task);
        else {
            setTimeout(() => executeWatchTask(task), task.executeTime - now);
            remaining.push(task);
        }
    }
    await saveSched(remaining);
}

// ========== 折叠功能 ==========
window.toggleNoteExpand = function(id) {
    // 将原本的 `note-short-${id}` 改为 `${id}-short`
    const shortEl = document.getElementById(`${id}-short`);
    const fullEl = document.getElementById(`${id}-full`);
    
    if (!shortEl || !fullEl) {
        console.warn('折叠元素未找到，ID:', id);
        return;
    }
    if (shortEl.style.display === 'none') {
        shortEl.style.display = 'block';
        fullEl.style.display = 'none';
    } else {
        shortEl.style.display = 'none';
        fullEl.style.display = 'block';
    }
};

// ========== 渲染 ==========
function renderWatchlist() {
    const list = document.getElementById('watchlist-list');
    if (!list) return;
    const partner = (typeof settings !== 'undefined' && settings.partnerName) ? settings.partnerName : '梦角';
    const filtered = watchFilter === 'all'
        ? watchlistData
        : watchlistData.filter(item => item.status === watchFilter);

    if (filtered.length === 0) {
        list.innerHTML = `<div class="empty-state">最近看了什么，和我分享吧～</div>`;
        return;
    }

    loadSched().then(tasks => {
        const reversed = [...filtered].reverse();
        list.innerHTML = reversed.map((item, rIdx) => {
            const originalIndex = watchlistData.indexOf(item);
            const icon = item.type === 'book' ? '📖' : '🎬';
            const starStr = '⭐'.repeat(Math.min(item.rating || 0, 5));
            const dateStr = new Date(item.createdAt).toLocaleDateString('zh-CN');
            const note = item.note || '';
            const noteId = `note-${originalIndex}`; // 使用原始索引保证唯一

            // 备注处理
            let noteHtml = '';
            if (note.length > 80) {
                noteHtml = `
                    <div class="watchlist-note" id="${noteId}-short">${note.slice(0, 80)}...
                        <span class="note-expand" onclick="toggleNoteExpand('${noteId}')">展开全文</span>
                    </div>
                    <div class="watchlist-note" id="${noteId}-full" style="display:none;">
                        ${note}
                        <span class="note-expand" onclick="toggleNoteExpand('${noteId}')">收起</span>
                    </div>`;
            } else if (note) {
                noteHtml = `<div class="watchlist-note">${note}</div>`;
            }

            // 评论区
            let commentsHtml = '';
            (item.comments || []).forEach(c => {
                commentsHtml += `
                <div class="comment-item">
                    <span class="comment-author">${partner}：</span>
                    <span class="comment-text">${c.text}</span>
                    <span class="comment-time">${new Date(c.time).toLocaleString('zh-CN', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
                </div>`;
            });
            if (commentsHtml) commentsHtml = `<div class="watchlist-comments">${commentsHtml}</div>`;

            // 排队状态
            const hasTask = tasks.some(t => t.type === 'watchlist' && t.itemIndex === originalIndex);
            let pendingHtml = '';
            let btnClass = 'wishlist-btn comment-btn';
            if (hasTask) {
                const t = tasks.find(t => t.type === 'watchlist' && t.itemIndex === originalIndex);
                const m = Math.max(1, Math.round((t.executeTime - Date.now()) / 60000));
                pendingHtml = `<div class="comment-pending">🕒 梦角的点评预计 ${m} 分钟后送达</div>`;
                btnClass += ' comment-active';
            }

            const statusClass = item.status === '已看' ? 'status-done' : 'status-wish';

            return `
            <div class="watchlist-card">
                ${noteHtml}
                <div class="watchlist-info-box">
                    <div class="watchlist-info-left">
                        <div class="info-title">${icon} ${item.title}</div>
                        <div class="info-rating">${starStr || '暂未评分'}</div>
                    </div>
                    <span class="watchlist-tag ${statusClass}">${item.status}</span>
                </div>
                <div class="watchlist-footer">
                    <span class="watchlist-date">添加于 ${dateStr}</span>
                    <div class="watchlist-actions">
                        <button class="wishlist-btn" onclick="editWatchlistItem(${originalIndex})">编辑</button>
                        <button class="wishlist-btn delete" onclick="deleteWatchlistItem(${originalIndex})">删除</button>
                        <button class="${btnClass}" onclick="scheduleWatchComment(${originalIndex})">${partner}想说</button>
                    </div>
                </div>
                ${pendingHtml}
                ${commentsHtml}
            </div>`;
        }).join('');
    });
}

// ========== CRUD ==========
function openAddWatchlistDialog() {
    document.getElementById('watchlist-add-form').style.display = 'block';
    document.getElementById('watchlist-list').style.display = 'none';
    document.getElementById('watchlist-add-title').textContent = '添加记录';
    document.getElementById('watchlist-title-input').value = '';
    document.getElementById('watchlist-type-select').value = 'movie';
    document.getElementById('watchlist-status-select').innerHTML = `<option value="想看">想看</option><option value="已看">已看</option>`;
    document.getElementById('watchlist-status-select').value = '想看';
    document.getElementById('watchlist-rating-input').value = '0';
    document.getElementById('watchlist-note-input').value = '';
    document.getElementById('watchlist-edit-index').value = '-1';
}
function editWatchlistItem(index) {
    const item = watchlistData[index];
    if (!item) return;
    document.getElementById('watchlist-add-title').textContent = '编辑记录';
    document.getElementById('watchlist-title-input').value = item.title;
    document.getElementById('watchlist-type-select').value = item.type;
    document.getElementById('watchlist-status-select').innerHTML = `<option value="想看">想看</option><option value="已看">已看</option>`;
    document.getElementById('watchlist-status-select').value = item.status;
    document.getElementById('watchlist-rating-input').value = item.rating || 0;
    document.getElementById('watchlist-note-input').value = item.note || '';
    document.getElementById('watchlist-edit-index').value = index;
    document.getElementById('watchlist-add-form').style.display = 'block';
    document.getElementById('watchlist-list').style.display = 'none';
}
function cancelWatchlistForm() {
    document.getElementById('watchlist-add-form').style.display = 'none';
    document.getElementById('watchlist-list').style.display = 'block';
}
async function saveWatchlistItem() {
    const title = document.getElementById('watchlist-title-input').value.trim();
    if (!title) { showNotification('请输入标题', 'warning'); return; }
    const editIndex = parseInt(document.getElementById('watchlist-edit-index').value);
    const base = editIndex >= 0 ? watchlistData[editIndex] : null;
    const item = {
        title,
        type: document.getElementById('watchlist-type-select').value,
        status: document.getElementById('watchlist-status-select').value,
        rating: parseInt(document.getElementById('watchlist-rating-input').value) || 0,
        note: document.getElementById('watchlist-note-input').value.trim(),
        comments: base ? (base.comments || []) : [],
        createdAt: editIndex >= 0 ? (base.createdAt || Date.now()) : Date.now()
    };
    if (editIndex >= 0) watchlistData[editIndex] = item;
    else watchlistData.push(item);
    await saveWatchlistData();
    renderWatchlist();
    cancelWatchlistForm();
    showNotification(editIndex >= 0 ? '记录已更新' : '记录已添加', 'success');
}
async function deleteWatchlistItem(index) {
    if (!confirm('确定删除这条记录吗？')) return;
    watchlistData.splice(index, 1);
    await saveWatchlistData();
    renderWatchlist();
    showNotification('记录已删除', 'success');
}

// ========== 筛选 ==========
function setWatchFilter(filter) {
    watchFilter = filter;
    // 移除所有高亮
    document.querySelectorAll('.watch-filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // 给对应按钮加高亮 (新增 ID 映射逻辑)
    let btnId = 'filter-all';
    if (filter === '想看') btnId = 'filter-wish';
    if (filter === '已看') btnId = 'filter-done';
    
    const activeBtn = document.getElementById(btnId);
    if (activeBtn) activeBtn.classList.add('active');
    
    renderWatchlist();
}

// ========== 模态框打开 ==========
async function openWatchlistModal() {
    await loadWatchlistData();
    await restoreSched();
    watchFilter = 'all';
    renderWatchlist();
    document.getElementById('watchlist-add-form').style.display = 'none';
    document.getElementById('watchlist-list').style.display = 'block';
    showModal(document.getElementById('watchlist-modal'));
    // 设置全部按钮高亮
    document.querySelectorAll('.watch-filter-btn').forEach(btn => btn.classList.remove('active'));
    const allBtn = document.getElementById('filter-all');
    if (allBtn) allBtn.classList.add('active');
}

// ========== 初始化 ==========
function initWatchlistListeners() {
    document.getElementById('watchlist-function')?.addEventListener('click', () => {
        hideModal(document.getElementById('advanced-modal'));
        openWatchlistModal();
    });
    document.getElementById('watchlist-add-btn')?.addEventListener('click', openAddWatchlistDialog);
    document.getElementById('watchlist-cancel-btn')?.addEventListener('click', cancelWatchlistForm);
    document.getElementById('watchlist-save-btn')?.addEventListener('click', saveWatchlistItem);
    document.getElementById('close-watchlist')?.addEventListener('click', () => hideModal(document.getElementById('watchlist-modal')));
    document.getElementById('filter-all')?.addEventListener('click', () => setWatchFilter('all'));
    document.getElementById('filter-wish')?.addEventListener('click', () => setWatchFilter('想看'));
    document.getElementById('filter-done')?.addEventListener('click', () => setWatchFilter('已看'));
}