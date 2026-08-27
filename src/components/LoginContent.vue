<script setup>
  import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import LoginByQRCode from './LoginByQRCode.vue'
  import LoginByAccount from './LoginByAccount.vue'
  import LoginByQQQRCode from './LoginByQQQRCode.vue'

  const route = useRoute()
  const router = useRouter()

  const loginByQR = ref(null)
  const qqLoginByQR = ref(null)
  const loginByAC = ref(null)
  const jumpPage = ref(false)
  const jumpTimer = ref(null)

  // 0: 二维码 1: 手机验证码登录
  const loginMode = ref(0)

  const isQrMode = computed(() => loginMode.value === 0)
  const isQQMode = computed(() => Number(route.query.mode) === 2)

  const syncModeFromRoute = () => {
    const queryMode = Number(route.query.mode)

    // 仅保留两种稳定入口：0=二维码，1=手机验证码
    if (queryMode === 1) {
      loginMode.value = 1
      return
    }

    // mode=0 或任何非法值（含旧的 3/4）统一回退到二维码
    loginMode.value = 0
  }

  const enterQrMode = () => {
    if (isQQMode.value) return
    loginMode.value = 0
    loginByQR.value?.checkQR()
  }

  const changeMode = (mode) => {
    if (mode === 2) {
      enterQrMode()
      return
    }

    loginMode.value = 1
    loginByAC.value?.inputFocus()
    loginByQR.value?.clearTimer()
  }

  const register = () => {
    const url = 'https://music.163.com/'
    if (typeof windowApi !== 'undefined' && windowApi?.toRegister) {
      windowApi.toRegister(url)
    } else {
      window.open(url, '_blank')
    }
  }

  // 登录成功后动画并跳转
  const jumpTo = () => {
    loginByQR.value?.clearTimer()
    if (jumpTimer.value) {
      clearTimeout(jumpTimer.value)
      jumpTimer.value = null
    }
    jumpPage.value = true
    jumpTimer.value = setTimeout(() => {
      router.push(route.query.from === 'settings' ? '/settings' : '/mymusic')
      jumpPage.value = false
      jumpTimer.value = null
    }, 3000)
  }

  watch(() => route.query.mode, () => {
    syncModeFromRoute()
    if (isQQMode.value) {
      qqLoginByQR.value?.load()
    } else if (isQrMode.value) {
      loginByQR.value?.checkQR()
    } else {
      loginByQR.value?.clearTimer()
    }
  }, { immediate: true })

  onActivated(() => {
    syncModeFromRoute()
    if (isQQMode.value) {
      qqLoginByQR.value?.load()
    } else if (isQrMode.value) {
      loginByQR.value?.checkQR()
    }
  })

  onMounted(() => {
    if (isQQMode.value) qqLoginByQR.value?.load()
  })

  onDeactivated(() => {
    loginByQR.value?.clearTimer()
    qqLoginByQR.value?.clearTimer()
  })

  onUnmounted(() => {
    loginByQR.value?.clearTimer()
    qqLoginByQR.value?.clearTimer()
    if (jumpTimer.value) {
      clearTimeout(jumpTimer.value)
      jumpTimer.value = null
    }
  })
</script>

  <template>
  <div class="login-content" :class="{ jumpPage: jumpPage }">
    <div class="login-container">
      <div class="login-header" v-if="!isQQMode">
        <div class="login-icon">
          <img src="../assets/img/netease-music.png" alt="">
        </div>
        <span class="login-title">登录网易云账号</span>
      </div>

      <div class="login-header" v-if="isQQMode">
        <div class="login-icon qq-icon">QQ</div>
        <span class="login-title">登录 QQ 音乐账号</span>
      </div>

      <LoginByQQQRCode v-if="isQQMode" ref="qqLoginByQR" class="qrcode-container" @jumpTo="jumpTo" />

      <LoginByQRCode v-if="!isQQMode"
        ref="loginByQR"
        class="qrcode-container"
        :firstLoadMode="loginMode"
        v-show="isQrMode"
        @jumpTo="jumpTo"
      />

      <LoginByAccount v-if="!isQQMode"
        ref="loginByAC"
        class="account-container"
        v-show="!isQrMode"
        @jumpTo="jumpTo"
      />

      <div class="login-other" v-if="!isQQMode">
        <span class="qrcode-tip" v-show="isQrMode">打开网易云 APP 扫码登录</span>

        <div class="login-method" v-show="isQrMode">
          <span @click="changeMode(1)">手机验证码登录</span>
        </div>

        <div class="login-method" v-show="!isQrMode">
          <span @click="changeMode(2)">二维码登录</span>
        </div>

        <div class="to-register" v-show="!isQrMode">
          <span @click="register">没有账号？去注册</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
  .login-content {
    height: 100%;
    --login-title: #000000;
    --login-text: #000000;
    --login-muted: rgb(111, 111, 111);

    .login-container {
      display: flex;
      flex-direction: column;
      justify-content: center;
      height: calc(100% - 120px);

      .login-header {
        display: flex;
        flex-direction: column;
        align-items: center;

        .login-icon {
          margin-bottom: 1.5vh;
          width: 6.5vh;
          height: 6.5vh;
          background-color: rgb(226, 0, 0);

          img {
            width: 100%;
            height: 100%;
          }
        }

        .login-title {
          font: 2.7vh SourceHanSansCN-Bold;
          color: var(--login-title);
        }
      }

      .login-other {
        margin-top: 5.5vh;

        .qrcode-tip {
          font: 13px SourceHanSansCN-Bold;
          color: var(--login-text);
        }

        .login-method {
          span {
            font: 12px SourceHanSansCN-Bold;
            color: var(--login-muted);
            transition: 0.2s;

            &:hover {
              cursor: pointer;
              color: var(--login-text);
            }
          }

          .separation {
            margin: 0 4px;
            pointer-events: none;
          }
        }

        .to-register {
          display: flex;
          justify-content: center;

          span {
            font: 12px SourceHanSansCN-Bold;
            color: var(--login-muted);

            &:hover {
              cursor: pointer;
              color: var(--login-text);
            }
          }
        }
      }
    }
  }

  .jumpPage {
    opacity: 0;
    transform: scale(0.4);
    transition: 0.6s 2.2s cubic-bezier(.47, 0, .98, .58);
  }

  :global(.dark) .login-content {
    --login-title: #f2f5f7;
    --login-text: #f2f5f7;
    --login-muted: #adb4bf;
  }
</style>
