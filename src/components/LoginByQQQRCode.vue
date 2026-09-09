<script setup>
  import { onUnmounted, ref, watch } from 'vue'
  import { onBeforeRouteLeave } from 'vue-router'
  import QRCode from 'qrcode'
  import DataCheckAnimaton from './DataCheckAnimaton.vue'
  import { getQQLoginQr, checkQQLoginQr } from '../api/qq'
  import { noticeOpen } from '../utils/dialog'
  import { qqAccountStore } from '../store/qqAccountStore'
  import { extractQQLoginPayload, sanitizeQQQrImage } from '../utils/qqSession.mjs'

  const emits = defineEmits(['jumpTo'])

  const loging = ref(-1)
  const loginSessionId = ref(null)
  const qrcodeImg = ref('')
  const qrStatus = ref(801)
  const statusTitle = ref('请使用 QQ 音乐扫码')
  const statusTitleEN = ref('QQ MUSIC')
  const checkQRInterval = ref(null)
  const loadingQr = ref(false)
  const pollingActive = ref(false)
  const pollingInFlight = ref(false)
  const loginCompleted = ref(false)
  let pollingSessionId = 0
  let qrLoadSessionId = 0

  const resetQrState = () => {
    clearTimer()
    loginCompleted.value = false
    pollingInFlight.value = false
    loginSessionId.value = null
    qrcodeImg.value = ''
    qrStatus.value = 801
    statusTitle.value = '请使用 QQ 音乐扫码'
    statusTitleEN.value = 'QQ MUSIC'
    loging.value = -1
  }

  const clearTimer = () => {
    pollingSessionId += 1
    if (checkQRInterval.value) {
      clearTimeout(checkQRInterval.value)
      checkQRInterval.value = null
    }
    pollingActive.value = false
  }

  const scheduleNextPoll = (sessionId, delay = 1000) => {
    if (sessionId !== pollingSessionId || !pollingActive.value || loginCompleted.value) return

    if (checkQRInterval.value) {
      clearTimeout(checkQRInterval.value)
    }

    checkQRInterval.value = setTimeout(async () => {
      if (sessionId !== pollingSessionId) return
      checkQRInterval.value = null
      await checkQr(sessionId)
      if (sessionId !== pollingSessionId || !pollingActive.value || loginCompleted.value) return
      if (qrStatus.value === 800 || qrStatus.value === 803) return
      scheduleNextPoll(sessionId)
    }, delay)
  }

  const startPolling = () => {
    if (loginCompleted.value) return
    clearTimer()
    pollingActive.value = true
    const sessionId = pollingSessionId
    scheduleNextPoll(sessionId)
  }

  const load = async () => {
    if (loadingQr.value) return

    const loadSessionId = ++qrLoadSessionId
    resetQrState()
    loadingQr.value = true

    try {
      const result = await getQQLoginQr()
      if (loadSessionId !== qrLoadSessionId) return
      const data = extractQQLoginPayload(result) || result
      const sessionId = String(result?.sessionId || data?.sessionId || '')
      const url = sanitizeQQQrImage(String(data?.img || data?.url || data?.qrUrl || data?.qrimg || ''))
      if (!sessionId || !url) {
        throw new Error('无法创建 QQ 登录二维码')
      }

      loginSessionId.value = sessionId
      qrcodeImg.value = String(url).startsWith('data:') ? url : await QRCode.toDataURL(url, { width: 192, margin: 1 })
      if (loadSessionId !== qrLoadSessionId) return

      startPolling()
    } catch (error) {
      if (loadSessionId !== qrLoadSessionId) return
      noticeOpen(error?.message || '二维码加载失败，请重试', 2)
      loginSessionId.value = null
      qrStatus.value = 800
      statusTitle.value = '二维码加载失败, 点击刷新'
      statusTitleEN.value = 'ERROR'
      loging.value = -1
    } finally {
      loadingQr.value = false
    }
  }

  const checkQr = async (sessionId = pollingSessionId) => {
    if (sessionId !== pollingSessionId || !loginSessionId.value || loginCompleted.value || pollingInFlight.value) return

    pollingInFlight.value = true

    try {
      const result = await checkQQLoginQr(loginSessionId.value)
      if (sessionId !== pollingSessionId) return

      const payload = extractQQLoginPayload(result) || result
      const rawCode = result?.code ?? payload?.code
      const code = payload?.isOk === true || payload?.success === true
        ? 803
        : (payload?.refresh === true ? 800 : Number(rawCode))

      if (code === 800) {
        qrStatus.value = 800
        clearTimer()
      } else if (code === 801) {
        qrStatus.value = 801
      } else if (code === 802) {
        qrStatus.value = 802
      } else if (code === 803) {
        const clientSession = payload?.clientSession || result?.clientSession
        loginCompleted.value = true
        loginSessionId.value = null
        clearTimer()

        if (clientSession) {
          qqAccountStore.setSessionToken(clientSession)
          await qqAccountStore.restoreSession()
          if (qqAccountStore.loggedIn) {
            qrStatus.value = 803
            emits('jumpTo')
            return
          }
        }

        loginCompleted.value = false
        qrStatus.value = 800
        noticeOpen('QQ 登录校验失败, 请重新扫码', 2)
      }
    } catch (_) {
      // 轮询失败保持静默，避免频繁打断
    } finally {
      if (sessionId === pollingSessionId) {
        pollingInFlight.value = false
      }
    }
  }

  const refreshQRCode = () => {
    if (qrStatus.value === 800 || qrStatus.value === 802) {
      loging.value = -2
      load()
    }
  }

  defineExpose({ load, clearTimer })

  watch(() => qrStatus.value, (newVal) => {
    if (newVal === 800) {
      statusTitle.value = '二维码过期, 点击刷新'
      statusTitleEN.value = 'ERROR'
      loging.value = -1
    } else if (newVal === 801) {
      statusTitle.value = '请使用 QQ 音乐扫码'
      statusTitleEN.value = 'QQ MUSIC'
      loging.value = -1
    } else if (newVal === 802) {
      statusTitle.value = '请在手机端确认登录'
      statusTitleEN.value = 'CONFIRM'
      loging.value = 1  // 状态1: 隐藏二维码但不播放成功动画
    } else if (newVal === 803) {
      statusTitle.value = '登录成功'
      statusTitleEN.value = 'SUCCESS'
      loging.value = 3  // 状态3: 播放登录成功动画
    }
  })

  onBeforeRouteLeave(() => {
    clearTimer()
  })

  onUnmounted(() => {
    clearTimer()
  })
</script>

<template>
  <div class="qrcode-container" @click="refreshQRCode">
    <div class="qrcode-border" :class="{ 'qrcode-loging-1': loging == 1, 'qrcode-loging-1 qrcode-loging-2': loging == 3 }">
      <div class="qrcode" :class="{ 'qrcode-hiding': loging == 1, 'qrcode-checking': loging == 3, 'qrcode-invalid': qrStatus == 800, 'qrcode-recover': loging == -2 }">
        <img :src="qrcodeImg" alt="QQ 音乐登录二维码" v-show="qrcodeImg">
        <span class="qrcode-loading" v-show="!qrcodeImg">Loading...</span>
      </div>
      <div class="qrcode-status" :class="{ 'qrcode-checking': loging == 3, 'status-1': qrStatus == 800, 'status-2': qrStatus == 802, 'status-3': loging == 1, hide: loging == -2 }">{{ statusTitle }}</div>
      <div class="border border1"></div>
      <div class="border border2"></div>
      <div class="border border3"></div>
      <div class="border border4"></div>
      <div class="qr-line qr-line1"></div>
      <div class="qr-line qr-line2"></div>
      <div class="qr-line qr-line3"></div>
      <div class="qr-line qr-line4"></div>
      <div class="qrcode-text">{{ statusTitleEN }}</div>
      <DataCheckAnimaton class="check-animation" v-show="loging == 3"></DataCheckAnimaton>
    </div>
  </div>
</template>

<style scoped lang="scss">
  .qrcode-container {
    margin-top: 7vh;
    display: flex;
    justify-content: center;
    align-items: center;
    --qrcode-text: var(--text);
    --qrcode-border: var(--text);
    --qrcode-line: var(--text);
    --qrcode-line-fade: var(--border);
    --qrcode-status-bg: #000000;
    --qrcode-status-text: #ffffff;
    --qrcode-status-danger: #d10000;

    &:hover {
      cursor: pointer;
    }

    .qrcode-border {
      width: 27.6vh;
      height: 27.6vh;
      position: relative;
      transition: 0.3s;

      .qrcode {
        width: 26vh;
        height: 26vh;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        transition: all 0.3s cubic-bezier(0.14, 0.91, 0.58, 1);

        img {
          width: 100%;
          height: 100%;
        }

        .qrcode-loading {
          font: 18px Gilroy-ExtraBold;
          line-height: 26vh;
          color: var(--qrcode-text);
        }
      }

      .qrcode-checking {
        opacity: 0 !important;
        transition: 0.2s 1s !important;
      }

      .qrcode-hiding {
        width: 22vh !important;
        height: 22vh !important;
        opacity: 0.3;
        transition: all 0.3s cubic-bezier(0.14, 0.91, 0.58, 1);
      }

      .qrcode-invalid {
        opacity: 0.5;
        transition: 0.3s;
      }

      .qrcode-recover {
        opacity: 1 !important;
      }

      .qrcode-status {
        width: 0;
        background-color: var(--qrcode-status-bg);
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font: 14px SourceHanSansCN-Bold;
        color: rgba(255, 255, 255, 0);
        white-space: nowrap;
        opacity: 0;
        transition: 0.3s;
      }

      .hide {
        opacity: 0 !important;
      }

      .status-1 {
        background-color: var(--qrcode-status-danger);
        animation: status 0.3s cubic-bezier(.13, .86, .51, .98) forwards;
      }

      .status-2 {
        background-color: var(--qrcode-status-bg);
        animation: status 0.3s cubic-bezier(.13, .86, .51, .98) forwards;
      }

      .status-3 {
        background-color: var(--qrcode-status-bg);
        animation: status 0.3s cubic-bezier(.13, .86, .51, .98) forwards;
      }

      @keyframes status {
        0% {
          opacity: 1;
        }

        100% {
          width: 100%;
          opacity: 1;
          color: var(--qrcode-status-text);
        }
      }

      .border {
        width: 40px;
        height: 40px;
        position: absolute;
      }

      $borderWidth: 2 + px;

      .border1 {
        border: {
          top: $borderWidth solid var(--qrcode-border);
          left: $borderWidth solid var(--qrcode-border);
        };

        top: 0;
        left: 0;
      }

      .border2 {
        border: {
          top: $borderWidth solid var(--qrcode-border);
          right: $borderWidth solid var(--qrcode-border);
        };

        top: 0;
        right: 0;
      }

      .border3 {
        border: {
          bottom: $borderWidth solid var(--qrcode-border);
          right: $borderWidth solid var(--qrcode-border);
        };

        bottom: 0;
        right: 0;
      }

      .border4 {
        border: {
          bottom: $borderWidth solid var(--qrcode-border);
          left: $borderWidth solid var(--qrcode-border);
        };

        bottom: 0;
        left: 0;
      }

      .qr-line {
        width: 40px;
        height: 1px;
        background: linear-gradient(to right, var(--qrcode-line) 30%, var(--qrcode-line-fade));
        position: absolute;
      }

      .qr-line1 {
        top: -13px;
        left: -32px;
        transform: rotate(-135deg);
      }

      .qr-line2 {
        top: -13px;
        right: -32px;
        transform: rotate(-45deg);
      }

      .qr-line3 {
        bottom: -13px;
        right: -32px;
        transform: rotate(45deg);
      }

      .qr-line4 {
        bottom: -13px;
        left: -32px;
        transform: rotate(135deg);
      }

      .qrcode-text {
        font: 1vh Geometos;
        color: var(--qrcode-text);
        position: absolute;
        top: -1.2vh;
        left: 0.2vh;
      }

      .check-animation {
        width: 100%;
        height: 100%;
        position: absolute;
      }
    }

    .qrcode-loging-1 {
      width: 22vh;
      height: 22vh;
      transition: 0.2s ease;
    }

    .qrcode-loging-2 {
      .border,
      .qr-line {
        animation: qrcode-acticity 0.3s 0.2s forwards;
      }

      @keyframes qrcode-acticity {
        0% {
          opacity: 0;
        }

        20% {
          opacity: 1;
        }

        40% {
          opacity: 0;
        }

        60% {
          opacity: 1;
        }

        80% {
          opacity: 0;
        }

        90% {
          opacity: 1;
        }

        100% {
          opacity: 0;
        }
      }
    }
  }

  :global(.dark) .qrcode-container {
    --qrcode-text: var(--text);
    --qrcode-border: var(--text);
    --qrcode-line: var(--text);
    --qrcode-line-fade: var(--border);
    --qrcode-status-bg: rgba(17, 24, 33, 0.92);
    --qrcode-status-text: #f2f5f7;
    --qrcode-status-danger: #ef5350;
  }
</style>
