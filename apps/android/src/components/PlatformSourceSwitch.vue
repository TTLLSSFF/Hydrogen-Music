<script setup>
  import { computed } from 'vue'
  import { storeToRefs } from 'pinia'
  import { useOtherStore } from '../store/otherStore'

  // 首页 / 搜索页 / 设置页共用同一个平台来源开关：
  // menu 为首页与搜索页的「鼠标预选」模式（悬停展开平台子选项），toggle 为设置页的开关（网易云=关、QQ=开）。
  const props = defineProps({
    variant: {
      type: String,
      default: 'toggle',
    },
    labelOff: {
      type: String,
      default: '网易云音乐',
    },
    labelOn: {
      type: String,
      default: 'QQ音乐',
    },
  })

  const otherStore = useOtherStore()
  const { searchSource } = storeToRefs(otherStore)
  const isQQSource = computed(() => searchSource.value === 'qq')
  // 收起态只显示当前平台名，展开后由子选项表达完整状态
  const currentLabel = computed(() => (isQQSource.value ? props.labelOn : props.labelOff))

  const selectSource = source => {
    if (otherStore.searchSource === source) return
    otherStore.setSearchSource(source)
  }
  const toggleSource = () => selectSource(isQQSource.value ? 'netease' : 'qq')
</script>

<template>
  <div :class="variant === 'menu' ? 'platform-source-switch' : 'toggle'" @click="variant === 'menu' ? null : toggleSource()">
    <template v-if="variant === 'menu'">
      <div class="source-trigger">{{ currentLabel }}</div>
      <div class="source-menu">
        <div class="source-option" :class="{ 'source-option-active': !isQQSource }" @click="selectSource('netease')">{{ labelOff }}</div>
        <div class="source-option" :class="{ 'source-option-active': isQQSource }" @click="selectSource('qq')">{{ labelOn }}</div>
      </div>
    </template>
    <template v-else>
      <div class="toggle-off" :class="{ 'toggle-on-in': isQQSource }">{{ currentLabel }}</div>
      <Transition name="toggle">
        <div class="toggle-on" v-show="isQQSource"></div>
      </Transition>
    </template>
  </div>
</template>

<style scoped lang="scss">
  // 鼠标预选模式：与歌单详情「选择」子项同一套设计语言
  // —— 收起时只留当前平台名，悬停后子选项从左滑入，悬停项带浅色遮罩。
  .platform-source-switch {
    --ps-option-hover-bg: rgba(0, 0, 0, 0.045);
    --ps-option-active-bg: rgba(0, 0, 0, 0.09);

    display: flex;
    flex-direction: row;
    align-items: center;
    flex-shrink: 0;
    // 遮罩高度与搜索框外边框高度（20px）齐平，并跟随搜索框下移 3px 对齐
    height: 20px;
    position: relative;
    bottom: -3px;

    // 20px 高的控件命中区域偏小，向外扩一圈避免鼠标微移时反复收展。
    // 必须置于内容之下，否则会盖住子选项、抢掉它们的悬停与点击。
    &::before {
      content: '';
      position: absolute;
      top: -8px;
      right: -8px;
      bottom: -8px;
      left: -8px;
      z-index: -1;
    }

    .source-trigger {
      display: flex;
      align-items: center;
      box-sizing: border-box;
      height: 20px;
      padding: 0 10px;
      max-width: 160px;
      overflow: hidden;
      font: 13px SourceHanSansCN-Bold;
      font-weight: bold;
      color: var(--text) !important;
      white-space: nowrap;
      cursor: pointer;
      opacity: 1;
      // 非悬停态：等子选项收完再淡入回来
      transition:
        opacity 0.2s ease 0.58s,
        max-width 0.2s cubic-bezier(0.14, 0.91, 0.58, 1) 0.58s;
    }

    .source-menu {
      display: flex;
      flex-direction: row;
      align-items: center;
      max-width: 0;
      opacity: 0;
      overflow: hidden;
      // 非悬停态：先让子项滑出，再收窄容器
      transition:
        max-width 0.28s cubic-bezier(0.14, 0.91, 0.58, 1) 0.28s,
        opacity 0s linear 0.48s;
    }

    .source-option {
      display: flex;
      align-items: center;
      box-sizing: border-box;
      height: 20px;
      padding: 0 10px;
      flex: 0 0 auto;
      font: 13px SourceHanSansCN-Bold;
      font-weight: bold;
      color: var(--text) !important;
      white-space: nowrap;
      opacity: 0;
      transform: translateX(-20px);
      pointer-events: none;
      transition: background-color 0.2s ease;
      animation: platform-option-slide-out 0.28s cubic-bezier(0.14, 0.91, 0.58, 1) backwards;

      &:nth-child(1) {
        animation-delay: 0.2s;
      }
      &:nth-child(2) {
        animation-delay: 0.15s;
      }
    }

    // 悬停浅色遮罩，高度即子选项高度（20px），与搜索框外边框齐平
    .source-option:hover {
      cursor: pointer;
      background-color: var(--ps-option-hover-bg);
    }
    .source-option-active {
      background-color: var(--ps-option-active-bg);
    }

    &:hover {
      .source-trigger {
        opacity: 0;
        max-width: 0;
        pointer-events: none;
        transition:
          opacity 0.15s ease 0s,
          max-width 0.2s cubic-bezier(0.14, 0.91, 0.58, 1) 0.15s;
      }
      .source-menu {
        max-width: 400px;
        opacity: 1;
        // 展开阶段必须放开裁剪，否则子项左滑入会被切掉
        overflow: visible;
        transition:
          max-width 0.28s cubic-bezier(0.14, 0.91, 0.58, 1) 0.05s,
          opacity 0.28s cubic-bezier(0.14, 0.91, 0.58, 1) 0.05s;
      }
      .source-option {
        opacity: 1;
        transform: none;
        pointer-events: auto;
        animation: platform-option-slide-in 0.28s cubic-bezier(0.14, 0.91, 0.58, 1) backwards;

        &:nth-child(1) {
          animation-delay: 0.25s;
        }
        &:nth-child(2) {
          animation-delay: 0.3s;
        }
      }
    }
  }

  @keyframes platform-option-slide-in {
    0% {
      opacity: 0;
      transform: translateX(-20px);
    }
    100% {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes platform-option-slide-out {
    0% {
      opacity: 1;
      transform: translateX(0);
    }
    100% {
      opacity: 0;
      transform: translateX(-20px);
    }
  }

  // 开关：与设置页原有标记同一套样式
  .toggle {
    margin-right: 1px;
    height: 34px;
    width: 200px;
    position: relative;
    overflow: hidden;
    isolation: isolate;
    &:hover {
      cursor: pointer;
    }
    .toggle-on,
    .toggle-off {
      padding: 5px 10px;
      width: 100%;
      height: 100%;
      font: 13px SourceHanSansCN-Bold;
      transition: 0.2s;
      line-height: 24px;
    }
    .toggle-off {
      background-color: rgba(255, 255, 255, 0.35);
    }
    .toggle-on {
      background-color: black;
      position: absolute;
      top: 0;
      left: 0;
      z-index: -1;
    }
    .toggle-on-in {
      color: white;
      background-color: transparent;
    }
  }

  // 开关滑块：与设置页一致
  .toggle-enter-active,
  .toggle-leave-active {
    transition: 0.1s;
  }
  .toggle-enter-from,
  .toggle-leave-to {
    transform: translateX(-100%);
  }
</style>

<style lang="scss">
  html.dark .platform-source-switch,
  .dark .platform-source-switch {
    --ps-option-hover-bg: rgba(255, 255, 255, 0.06);
    --ps-option-active-bg: rgba(255, 255, 255, 0.12);
  }
</style>
