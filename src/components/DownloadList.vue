<script setup>
  import { computed } from 'vue'
  import { storeToRefs } from 'pinia'
  import { usePlayerStore } from '../store/playerStore'
  import { useDownloadStore } from '../store/downloadStore'
  import { getSongDisplayName } from '../utils/songName'

  const props = defineProps({
    view: {
      type: String,
      default: 'downloading',
    },
  })

  const downloadStore = useDownloadStore()
  const { active, completed } = storeToRefs(downloadStore)
  const playerStore = usePlayerStore()
  const { showSongTranslation } = storeToRefs(playerStore)

  const activeList = computed(() => Array.isArray(active.value) ? active.value : [])
  const completedList = computed(() => Array.isArray(completed.value) ? completed.value : [])
  const canCancel = typeof windowApi !== 'undefined' && typeof windowApi.cancelDownload === 'function'

  const clampProgress = value => {
    const progressValue = Number(value)
    if (!Number.isFinite(progressValue)) return 0
    return Math.max(0, Math.min(100, Math.round(progressValue)))
  }

  const displayName = item => getSongDisplayName(
    { name: item?.name, tns: item?.tns },
    item?.name || '',
    showSongTranslation.value,
  )

  const cancelTask = item => {
    if (!canCancel) return
    windowApi.cancelDownload(item.id)
  }

  const cancelAll = () => {
    const ids = downloadStore.requestCancelAll()
    if (!canCancel) return
    ids.forEach(id => windowApi.cancelDownload(id))
  }
</script>

<template>
  <div class="download-list" :class="`download-list-${props.view}`">
    <template v-if="props.view === 'completed'">
      <Transition name="download-transition">
        <div class="download-control" v-show="completedList.length != 0">
          <span class="download-count">{{ completedList.length }} 条记录</span>
          <span class="download-clear-text" @click="downloadStore.clearCompleted()">清空</span>
        </div>
      </Transition>
      <div class="list-item">
        <div class="item" v-for="item in completedList" :key="item.id">
          <span class="download-index" :class="item.status">{{ item.status === 'success' ? '✓' : '×' }}</span>
          <div class="download">
            <div class="item-name">{{ displayName(item) }}</div>
            <div class="download-detail">
              <span class="download-status" :class="item.status">{{ item.status === 'success' ? '已完成' : '失败' }}</span>
              <span class="download-reason" v-if="item.status === 'success' && item.path" :title="item.path">{{ item.path }}</span>
              <span class="download-reason" v-else-if="item.status !== 'success'">{{ item.reason }}</span>
            </div>
          </div>
          <span class="download-remove" @click="downloadStore.removeCompleted(item.id)">移除</span>
        </div>
      </div>
      <Transition name="download-transition">
        <div v-show="completedList.length == 0" class="list-none">NONE</div>
      </Transition>
    </template>

    <template v-else>
      <Transition name="download-transition">
        <div class="download-control" v-show="activeList.length != 0">
          <span class="download-count">{{ activeList.length }} 项进行中</span>
          <span class="download-clear-text" @click="cancelAll()">全部取消</span>
        </div>
      </Transition>
      <div class="list-item">
        <div class="item" v-for="(item, index) in activeList" :key="item.id">
          <span class="download-index">{{ index + 1 }}</span>
          <div class="download">
            <div class="item-name">{{ displayName(item) }}</div>
            <div class="download-progress">
              <div class="progress">
                <div class="progress-fill" :style="{ width: clampProgress(item.progress) + '%' }"></div>
              </div>
              <span class="progress-num">{{ clampProgress(item.progress) }}%</span>
            </div>
          </div>
          <span class="download-cancel" @click="cancelTask(item)">取消</span>
        </div>
      </div>
      <Transition name="download-transition">
        <div v-show="activeList.length == 0" class="list-none">NONE</div>
      </Transition>
    </template>
  </div>
</template>

<style scoped lang="scss">
  .download-list{
    --download-text: #000000;
    --download-muted-text: #000000;
    --download-selected-bg: #000000;
    --download-selected-text: #ffffff;
    --download-hover-bg: rgba(0, 0, 0, 0.045);
    --download-progress-bg: rgba(0, 0, 0, 0.1);
    --download-progress-fill: #000000;
    --download-success: #2f9e44;
    --download-failed: #d64545;

    width: 100%;
    height: 100%;
    position: relative;
    .download-control{
      margin-bottom: 10Px;
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      font: 14Px SourceHanSansCN-Bold;
      color: var(--download-text);
      position: relative;
      .download-count{
        opacity: 0.7;
      }
      .download-clear-text{
        transition: 0.2s;
        &:hover{
          cursor: pointer;
          opacity: 0.6;
        }
      }
    }
    .list-item{
      width: 100%;
      .item{
        padding: 8Px 0;
        width: 100%;
        display: flex;
        flex-direction: row;
        align-items: center;
        transition: 0.2s;
        &:hover{
          background-color: var(--download-hover-bg);
        }
        .download-index{
          width: 30Px;
          font: 14Px Bender-Bold;
          color: var(--download-muted-text);
          &.success{
            color: var(--download-success);
          }
          &.failed{
            color: var(--download-failed);
          }
        }
        .download{
          width: 100%;
          .item-name{
            width: calc(100% - 50Px);
            font: 14Px SourceHanSansCN-Bold;
            color: var(--download-text);
            text-align: left;
            overflow: hidden;
            display: -webkit-box;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 1;
            word-break: break-all;
          }
          .download-progress{
            display: flex;
            flex-direction: row;
            align-items: center;
            .progress{
              width: 100%;
              height: 8Px;
              background-color: var(--download-progress-bg);
              overflow: hidden;
              .progress-fill{
                height: 100%;
                background-color: var(--download-progress-fill);
                transition: width 0.3s;
              }
            }
            .progress-num{
              width: 50Px;
              font: 12Px Bender-Bold;
              color: var(--download-muted-text);
              text-align: right;
            }
          }
          .download-detail{
            display: flex;
            flex-direction: row;
            align-items: center;
            font: 12Px SourceHanSansCN-Bold;
            color: var(--download-muted-text);
            .download-status{
              flex: 0 0 auto;
              margin-right: 8Px;
              &.success{
                color: var(--download-success);
              }
              &.failed{
                color: var(--download-failed);
              }
            }
            .download-reason{
              overflow: hidden;
              display: -webkit-box;
              -webkit-box-orient: vertical;
              -webkit-line-clamp: 1;
              word-break: break-all;
              opacity: 0.72;
            }
          }
        }
        .download-cancel, .download-remove{
          flex: 0 0 auto;
          font: 12Px SourceHanSansCN-Bold;
          color: var(--download-muted-text);
          transition: 0.2s;
          &:hover{
            cursor: pointer;
            color: var(--download-text);
          }
        }
      }
    }
    .list-none{
      width: 100%;
      font: 16Px Bender-Bold;
      color: var(--download-muted-text);
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      text-align: left;
    }


    .download-transition-enter-active,
    .download-transition-leave-active {
      transition: 0.2s cubic-bezier(.14,.91,.58,1);
    }

    .download-transition-enter-from,
    .download-transition-leave-to {
      opacity: 0;
      transform: scale(0.95);
    }
  }

  :global(html.dark) .download-list{
    --download-text: var(--text);
    --download-muted-text: var(--muted-text);
    --download-selected-bg: rgba(255, 255, 255, 0.9);
    --download-selected-text: #000000;
    --download-hover-bg: rgba(255, 255, 255, 0.06);
    --download-progress-bg: rgba(255, 255, 255, 0.16);
    --download-progress-fill: rgba(255, 255, 255, 0.9);
    --download-success: #69db7c;
    --download-failed: #ff8787;
  }
</style>