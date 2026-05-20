/**
 * 心愿清单 (最终版)
 * - 防重复评论
 * - 10~60分钟延时点评
 * - 空状态：“有什么想要的，全都告诉我吧～”
 * - 按钮：梦角想说（常态暗，排队后亮）
 * - 排版优化
 */
let wishlistData = [];
let wishFilter = 'all';
const wishExecuting = new Set(); // 防重入

// ========== 数据 ==========
function loadWishlistData() {
    return localforage.getItem(getStorageKey('wishlist')).then(data => {
        wishlistData = data || [];
        wishlistData.forEach(item => {
            if (item.bought === undefined) item.bought = false;
            if (!item.comments) item.comments = [];
        });
    }).catch(() => { wishlistData = []; });
}
function saveWishlistData() {
    const normalized = wishlistData.map(item => ({
        name: item.name, price: item.price, note: item.note,
        createdAt: item.createdAt, bought: item.bought,
        comments: item.comments || []
    }));
    localforage.setItem(getStorageKey('wishlist'), normalized);
    wishlistData = normalized;
}

// ========== 定时任务 ==========
function getSchedKey() { return getStorageKey('scheduledWishComments'); }
async function loadSched() { return (await localforage.getItem(getSchedKey())) || []; }
async function saveSched(tasks) { await localforage.setItem(getSchedKey(), tasks); }

async function scheduleWishlistComment(itemIndex) {
    const tasks = await loadSched();
    if (tasks.some(t => t.type === 'wishlist' && t.itemIndex === itemIndex)) {
        showNotification('梦角的点评已经在排着队啦～', 'info');
        return;
    }
    const replies = (typeof customReplies !== 'undefined' && customReplies.length > 0)
        ? customReplies : ['想要！', '这个我也喜欢！', '快加进购物车～'];

    // 随机抽取 1~3 条不同字卡，合并为一条消息
    const drawCount = Math.min(replies.length, Math.floor(Math.random() * 3) + 1);
    const shuffled = [...replies].sort(() => Math.random() - 0.5);
    const selectedTexts = shuffled.slice(0, drawCount);
    const combinedText = selectedTexts.join(' ');  // 用空格拼接，也可换成 '｜' 或 '\n'

    const delay = 600000 + Math.random() * 3000000; // 10~60分钟
    const executeTime = Date.now() + delay;
    const newTask = {
        type: 'wishlist',
        itemIndex,
        executeTime,
        text: combinedText   // 合并为一条消息
    };
    tasks.push(newTask);
    await saveSched(tasks);
    setTimeout(() => executeWishTask(newTask), delay);
    renderWishlist();
    showNotification('梦角的点评已排队，将在10分钟~1小时内送达 ✨', 'success');
}

async function executeWishTask(task) {
    const key = `wish_${task.itemIndex}`;
    if (wishExecuting.has(key)) return;
    wishExecuting.add(key);
    try {
        await loadWishlistData();
        const tasks = await loadSched();
        const idx = tasks.findIndex(t => t.type === 'wishlist' && t.itemIndex === task.itemIndex);
        if (idx === -1) return;
        if (wishlistData[task.itemIndex]) {
            if (!wishlistData[task.itemIndex].comments) wishlistData[task.itemIndex].comments = [];
            // 兼容旧数据：如果是数组则拼接，否则直接用字符串
            const commentText = Array.isArray(task.texts) 
                ? task.texts.join(' ') 
                : (task.text || '');
            wishlistData[task.itemIndex].comments.push({
                text: commentText,
                time: Date.now()
            });
            await saveWishlistData();
            renderWishlist();
            showNotification(`「${wishlistData[task.itemIndex].name}」收到了梦角的点评 ✨`, 'success');
        }
        tasks.splice(idx, 1);
        await saveSched(tasks);
    } finally {
        wishExecuting.delete(key);
    }
}

async function restoreWishSched() {
    const tasks = await loadSched();
    const now = Date.now();
    const remaining = [];
    for (const task of tasks) {
        if (task.type !== 'wishlist') { remaining.push(task); continue; }
        if (task.executeTime <= now) await executeWishTask(task);
        else {
            setTimeout(() => executeWishTask(task), task.executeTime - now);
            remaining.push(task);
        }
    }
    await saveSched(remaining);
}

// ========== 已购 ==========
async function toggleBought(index) {
    wishlistData[index].bought = !wishlistData[index].bought;
    await saveWishlistData();
    renderWishlist();
}

// ========== 渲染 ==========
function renderWishlist() {
    const list = document.getElementById('wishlist-list');
    if (!list) return;
    const partner = (typeof settings !== 'undefined' && settings.partnerName) ? settings.partnerName : '梦角';
    const filtered = wishFilter === 'all' ? wishlistData : wishlistData.filter(i => i.bought === (wishFilter === 'bought'));

    if (filtered.length === 0) {
        const msg = wishFilter === 'bought' ? '暂无已购心愿' : '有什么想要的，全都告诉我吧～';
        list.innerHTML = `<div class="empty-state">${msg}</div>`;
        return;
    }

    loadSched().then(tasks => {
        const reversed = [...filtered].reverse();
        list.innerHTML = reversed.map((item, rIdx) => {
            const idx = wishlistData.indexOf(item);
            const price = item.price ? `¥${parseFloat(item.price).toFixed(2)}` : '暂无价格';
            const date = new Date(item.createdAt).toLocaleDateString('zh-CN', { month:'numeric', day:'numeric' });

            let commentsHtml = '';
            (item.comments || []).forEach(c => {
                commentsHtml += `<div class="comment-item"><span class="comment-author">${partner}：</span><span class="comment-text">${c.text}</span><span class="comment-time">${new Date(c.time).toLocaleString('zh-CN', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span></div>`;
            });
            if (commentsHtml) commentsHtml = `<div class="wishlist-comments">${commentsHtml}</div>`;

            const hasTask = tasks.some(t => t.type === 'wishlist' && t.itemIndex === idx);
            let pendingHtml = '';
            let btnClass = 'wishlist-btn comment-btn';
            if (hasTask) {
                const t = tasks.find(t => t.type === 'wishlist' && t.itemIndex === idx);
                const m = Math.max(1, Math.round((t.executeTime - Date.now()) / 60000));
                pendingHtml = `<div class="comment-pending">🕒 梦角的点评预计 ${m} 分钟后送达</div>`;
                btnClass += ' comment-active';
            }

            return `
            <div class="wishlist-card${item.bought ? ' wishlist-bought' : ''}">
                <div class="wishlist-row1">
                    <div class="wishlist-title-date">
                        <span class="wishlist-name">${item.name}</span>
                        <span class="wishlist-date-inline">${date}</span>
                    </div>
                    <div class="wishlist-price">${price}</div>
                </div>
                ${item.note ? `<div class="wishlist-note">${item.note}</div>` : ''}
                <div class="wishlist-row3">
                    <label class="bought-label"><input type="checkbox" ${item.bought?'checked':''} onchange="toggleBought(${idx})">已购</label>
                    <div class="wishlist-btns">
                        <button class="wishlist-btn" onclick="editWishlistItem(${idx})">编辑</button>
                        <button class="wishlist-btn delete" onclick="deleteWishlistItem(${idx})">删除</button>
                        <button class="${btnClass}" onclick="scheduleWishlistComment(${idx})">${partner}想说</button>
                    </div>
                </div>
                ${pendingHtml}
                ${commentsHtml}
            </div>`;
        }).join('');
    });
}

// ========== CRUD ==========
function openAddWishlistDialog() {
    document.getElementById('wishlist-add-form').style.display = 'block';
    document.getElementById('wishlist-list').style.display = 'none';
    document.getElementById('wishlist-add-title').textContent = '添加心愿';
    document.getElementById('wishlist-name-input').value = '';
    document.getElementById('wishlist-price-input').value = '';
    document.getElementById('wishlist-note-input').value = '';
    document.getElementById('wishlist-edit-index').value = '-1';
}
function editWishlistItem(index) {
    const item = wishlistData[index]; if (!item) return;
    document.getElementById('wishlist-add-title').textContent = '编辑心愿';
    document.getElementById('wishlist-name-input').value = item.name;
    document.getElementById('wishlist-price-input').value = item.price || '';
    document.getElementById('wishlist-note-input').value = item.note || '';
    document.getElementById('wishlist-edit-index').value = index;
    document.getElementById('wishlist-add-form').style.display = 'block';
    document.getElementById('wishlist-list').style.display = 'none';
}
function cancelWishlistForm() {
    document.getElementById('wishlist-add-form').style.display = 'none';
    document.getElementById('wishlist-list').style.display = 'block';
}
function saveWishlistItem() {
    const name = document.getElementById('wishlist-name-input').value.trim();
    if (!name) { showNotification('请输入心愿名称', 'warning'); return; }
    const price = document.getElementById('wishlist-price-input').value.trim();
    const note = document.getElementById('wishlist-note-input').value.trim();
    const editIndex = parseInt(document.getElementById('wishlist-edit-index').value);
    const base = editIndex >= 0 ? wishlistData[editIndex] : null;
    const item = {
        name, price, note,
        comments: base ? (base.comments || []) : [],
        bought: base ? base.bought : false,
        createdAt: editIndex >= 0 ? (base.createdAt || Date.now()) : Date.now()
    };
    if (editIndex >= 0) wishlistData[editIndex] = item;
    else wishlistData.push(item);
    saveWishlistData();
    renderWishlist();
    cancelWishlistForm();
    showNotification(editIndex >= 0 ? '心愿已更新' : '心愿已添加', 'success');
}
function deleteWishlistItem(index) {
    if (!confirm('确定删除这个心愿吗？')) return;
    wishlistData.splice(index, 1);
    saveWishlistData();
    renderWishlist();
    showNotification('心愿已删除', 'success');
}

// ========== 筛选 ==========
function setWishFilter(filter) {
    wishFilter = filter;
    document.querySelectorAll('.wish-filter-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`wish-filter-${filter}`)?.classList.add('active');
    renderWishlist();
}

// ========== 模态框 ==========
async function openWishlistModal() {
    await loadWishlistData();
    await restoreWishSched();
    wishFilter = 'all';
    renderWishlist();
    document.getElementById('wishlist-add-form').style.display = 'none';
    document.getElementById('wishlist-list').style.display = 'block';
    showModal(document.getElementById('wishlist-modal'));
    document.querySelectorAll('.wish-filter-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('wish-filter-all')?.classList.add('active');
}

// ========== 初始化 ==========
function initWishlistListeners() {
    document.getElementById('wishlist-function')?.addEventListener('click', () => {
        hideModal(document.getElementById('advanced-modal'));
        openWishlistModal();
    });
    document.getElementById('wishlist-add-btn')?.addEventListener('click', openAddWishlistDialog);
    document.getElementById('wishlist-cancel-btn')?.addEventListener('click', cancelWishlistForm);
    document.getElementById('wishlist-save-btn')?.addEventListener('click', saveWishlistItem);
    document.getElementById('close-wishlist')?.addEventListener('click', () => hideModal(document.getElementById('wishlist-modal')));
    document.getElementById('wish-filter-all')?.addEventListener('click', () => setWishFilter('all'));
    document.getElementById('wish-filter-wish')?.addEventListener('click', () => setWishFilter('wish'));
    document.getElementById('wish-filter-bought')?.addEventListener('click', () => setWishFilter('bought'));
}