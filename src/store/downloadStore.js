import { defineStore } from "pinia";

// 下载状态模块：只负责「正在下载 / 下载完成」两份列表与持久化，
// 不再自己发起下载（音频解析、落盘统一由 utils/download.js → 主进程 download-to-folder 完成）。
const MAX_COMPLETED_RECORDS = 200;

export const useDownloadStore = defineStore('downloadStore', {
    state: () => {
        return {
            active: [],
            completed: [],
            cancelAllRequested: false,
        };
    },
    actions: {
        beginDownload(item = {}) {
            const id = String(item.id ?? '');
            if (!id) return;
            if (this.active.some(task => task.id === id)) return;
            this.active.push({
                id,
                name: item.name || '',
                tns: item.tns || null,
                artists: Array.isArray(item.artists) ? item.artists.filter(Boolean) : [],
                album: item.album || '',
                progress: 0,
            });
        },
        updateDownloadProgress(id, progress) {
            const task = this.active.find(item => item.id === String(id ?? ''));
            if (!task) return;
            const value = Number(progress);
            if (!Number.isFinite(value)) return;
            task.progress = Math.max(0, Math.min(100, Math.round(value)));
        },
        finishDownload(id, result = {}) {
            const taskId = String(id ?? '');
            const index = this.active.findIndex(item => item.id === taskId);
            const task = index >= 0 ? this.active[index] : null;
            if (index >= 0) this.active.splice(index, 1);

            const status = result.status === 'success' ? 'success' : 'failed';
            const record = {
                id: taskId,
                name: task?.name || result.name || '',
                tns: task?.tns || result.tns || null,
                artists: task?.artists || result.artists || [],
                album: task?.album || result.album || '',
                status,
                reason: status === 'failed' ? String(result.reason || '下载失败') : '',
                path: status === 'success' ? String(result.path || '') : '',
                time: Date.now(),
            };

            this.completed = [record, ...this.completed.filter(item => item.id !== taskId)];
            if (this.completed.length > MAX_COMPLETED_RECORDS) this.completed.splice(MAX_COMPLETED_RECORDS);
        },
        removeCompleted(id) {
            const taskId = String(id ?? '');
            this.completed = this.completed.filter(item => item.id !== taskId);
        },
        clearCompleted() {
            this.completed = [];
        },
        // 只请求停止：不清空 active，让进行中的那一首正常走完 finishDownload（保留歌曲名等信息）。
        requestCancelAll() {
            this.cancelAllRequested = true;
            return this.active.map(item => item.id);
        },
        resetCancelAll() {
            this.cancelAllRequested = false;
        },
    },
    persist: {
        storage: localStorage,
        pick: ['completed'],
    },
});