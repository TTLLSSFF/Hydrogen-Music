<script setup>
  import { computed, ref } from 'vue'
  import { useOtherStore } from '../store/otherStore';
  import { getCommitsPageUrl } from '../utils/appUpdate';
  const otherStore = useOtherStore()
  const show = ref(true)
  const showChangelog = ref(false)

  const stripMarkdown = value => String(value || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()

  const changelogLines = computed(() => {
    const raw = String(otherStore.updateChangelog || '').trim()
    if (!raw) return []

    return raw.split(/\r?\n/).map(line => {
      const text = line.trim()
      if (!text || /^[-*_]{3,}$/.test(text)) return { type: 'gap', text: '' }

      const heading = text.match(/^#{1,6}\s*(.+)$/)
      if (heading) return { type: 'heading', text: stripMarkdown(heading[1]) }

      const bullet = text.match(/^(?:[-*+]|\d+[.、)])\s*(.+)$/)
      if (bullet) return { type: 'bullet', text: stripMarkdown(bullet[1]) }

      return { type: 'text', text: stripMarkdown(text) }
    })
  })

  const changelogUrl = computed(() => otherStore.updateReleaseUrl || getCommitsPageUrl())

  const openChangelog = () => {
    showChangelog.value = true
  }
  const closeChangelog = () => {
    showChangelog.value = false
  }
  const toReleasesPage = () => {
    window.open(changelogUrl.value, '_blank')
  }
  const close = () => {
    show.value = !show.value
    setTimeout(() => {
        otherStore.toUpdate = false
    }, 400);
  }
</script>

<template>
    <div class="update-page">
        <div class="update-container" :class="{'update-container-close': !show}">
            <div class="back-img"></div>
            <div class="logo">
                <img src="../assets/icon/icon.ico" alt="">
                <div class="logo-title">
                    <div>Hydrogen</div>
                    <div>Music</div>
                </div>
            </div>
            <div class="update-animation">
                <svg t="1676121807390" class="update-icon-1" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="18788" data-spm-anchor-id="a313x.7781069.0.i24" width="200" height="200"><path d="M803.5 671.7l-34.8-114.3c-3.9-12.6-17.2-19.7-29.8-15.9l-114.3 34.8c-6.3 1.9-11.3 6.3-14.1 11.7l53.7 28.7c-34.6 52.8-94.4 87.7-162.3 87.7-97.6 0-178.2-72.2-191.7-166.1h-89.5C234.7 681.3 355.2 793 502 793c101.8 0 190.8-53.9 240.5-134.7l59.3 31.6c2.8-5.4 3.6-11.9 1.7-18.2zM221.7 354.9l34.8 114.3c3.9 12.6 17.2 19.7 29.8 15.9l114.3-34.8c6.3-1.9 11.3-6.2 14.1-11.6L361 410c34.6-52.8 94.4-87.7 162.3-87.7 97.6 0 178.2 72.2 191.7 166.1h89.5c-14-143-134.6-254.8-281.3-254.8-101.8 0-190.8 53.9-240.5 134.7l-59.3-31.6c-2.7 5.4-3.6 11.9-1.7 18.2z m290.7-289c246.9 0 447.7 200.9 447.7 447.7 0 246.9-200.9 447.7-447.7 447.7-246.9 0-447.7-200.9-447.7-447.7 0-246.8 200.9-447.7 447.7-447.7z" fill="#ffffff" p-id="18789" data-spm-anchor-id="a313x.7781069.0.i25" class="selected"></path></svg>
            </div>
            <div class="update-content">
                <div class="update-img">
                    <svg t="1676135394548" class="ani-1" viewBox="0 0 1820 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="3922" width="200" height="200"><path d="M1344.568889 770.180741L942.459259 222.90963c-5.12-6.921481-13.084444-10.998519-21.712592-11.188149-8.533333-0.094815-16.687407 3.792593-21.902223 10.61926L476.254815 769.611852c-4.645926 5.973333-3.508148 14.506667 2.465185 19.152592 5.973333 4.645926 14.506667 3.508148 19.152593-2.465185l422.589629-547.271111 402.10963 547.271111c4.456296 6.068148 12.98963 7.395556 19.057778 2.93926 6.068148-4.456296 7.395556-12.98963 2.939259-19.057778z" p-id="3923" fill="#ffffff"></path></svg>
                    <svg t="1676135394548" class="ani-2" viewBox="0 0 1820 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="3922" width="200" height="200"><path d="M1344.568889 770.180741L942.459259 222.90963c-5.12-6.921481-13.084444-10.998519-21.712592-11.188149-8.533333-0.094815-16.687407 3.792593-21.902223 10.61926L476.254815 769.611852c-4.645926 5.973333-3.508148 14.506667 2.465185 19.152592 5.973333 4.645926 14.506667 3.508148 19.152593-2.465185l422.589629-547.271111 402.10963 547.271111c4.456296 6.068148 12.98963 7.395556 19.057778 2.93926 6.068148-4.456296 7.395556-12.98963 2.939259-19.057778z" p-id="3923" fill="#ffffff"></path></svg>
                    <svg t="1676135394548" class="ani-3" viewBox="0 0 1820 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="3922" width="200" height="200"><path d="M1344.568889 770.180741L942.459259 222.90963c-5.12-6.921481-13.084444-10.998519-21.712592-11.188149-8.533333-0.094815-16.687407 3.792593-21.902223 10.61926L476.254815 769.611852c-4.645926 5.973333-3.508148 14.506667 2.465185 19.152592 5.973333 4.645926 14.506667 3.508148 19.152593-2.465185l422.589629-547.271111 402.10963 547.271111c4.456296 6.068148 12.98963 7.395556 19.057778 2.93926 6.068148-4.456296 7.395556-12.98963 2.939259-19.057778z" p-id="3923" fill="#ffffff"></path></svg>
                    <svg t="1676121383977" class="update-icon-2" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="12662" width="200" height="200"><path d="M1024 651.636364 512 0 0 651.636364 279.272727 651.636364 279.272727 1024 698.181818 1024 698.181818 651.636364Z" fill="#ffffff" p-id="12663"></path></svg>
                </div>
                <div class="update-info">
                    <span class="update-title">新版本追加</span>
                    <div class="update-version">
                        <span class="update-title-en">NEW VERSION</span>
                        <div class="version">{{ otherStore.newVersion }}</div>
                    </div>
                    <div class="update-option">
                        <div class="to-update" @click="openChangelog()">查看更新日志</div>
                        <div class="close" @click="close()">不要了，走了</div>
                        <svg t="1676132470655" class="close-icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2020" width="200" height="200"><path d="M745.610572 75.641771l-496.221642 0c-28.741601 0-51.259454 25.084305-51.259454 57.107649l0 789.362029 74.170257 0 0-772.299421 445.333648 0-331.506183 29.153994 0 766.881015 336.575642-27.442002 0 3.706415 74.170257 0L796.873096 132.74942C796.875143 100.725052 774.35729 75.641771 745.610572 75.641771zM428.767344 533.386076c-11.995195 0-21.719674-9.724479-21.719674-21.719674 0-11.995195 9.724479-21.719674 21.719674-21.719674 11.995195 0 21.719674 9.724479 21.719674 21.719674C450.487018 523.661597 440.763562 533.386076 428.767344 533.386076z" fill="#ffffff" p-id="2021"></path></svg>
                    </div>
                </div>
            </div>
        </div>

        <!-- 更新日志：展开动画复用「添加到歌单」 -->
        <Transition name="add-fade">
            <div class="update-changelog" v-if="showChangelog" @click="closeChangelog">
                <div class="changelog-container" @click.stop>
                    <div class="changelog-body">
                        <span class="changelog-title">更新日志</span>
                        <div class="changelog-list">
                            <template v-for="(line, index) in changelogLines" :key="`changelog-${index}`">
                                <div v-if="line.type === 'heading'" class="changelog-heading">{{ line.text }}</div>
                                <div v-else-if="line.type === 'bullet'" class="changelog-bullet">{{ line.text }}</div>
                                <div v-else-if="line.type === 'gap'" class="changelog-gap"></div>
                                <div v-else class="changelog-text">{{ line.text }}</div>
                            </template>
                            <div class="changelog-empty" v-if="!changelogLines.length">该版本暂无更新说明，可前往 GitHub 查看</div>
                        </div>
                        <div class="changelog-footer">
                            <div class="changelog-github" @click="toReleasesPage()">在 GitHub 查看</div>
                            <div class="changelog-back" @click="closeChangelog()">返回</div>
                        </div>
                        <span class="changelog-style5">LOG</span>
                    </div>
                    <span class="changelog-style changelog-style1"></span>
                    <span class="changelog-style changelog-style2"></span>
                    <span class="changelog-style changelog-style3"></span>
                    <span class="changelog-style changelog-style4"></span>
                </div>
            </div>
        </Transition>
    </div>
</template>

<style scoped lang="scss">
  .update-page{
    width: 100%;
    height: 100%;
    .update-container-close{
        animation: update-container-close 0.6s cubic-bezier(.5,0,.15,1) forwards !important;
        @keyframes update-container-close {
            0%{height: 50%;}
            100%{height: 0;}
        }
    }
    .update-container{
        width: 100%;
        height: 0;
        background-color: black;
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        overflow: hidden;
        animation: update-container-in 1.2s cubic-bezier(.5,0,.15,1) forwards;
        @keyframes update-container-in {
            0%{height: 0;}
            100%{height: 50%;}
        }
        .back-img{
            width: 70%;
            height: 200%;
            background-image: linear-gradient(to right, rgb(0, 0, 0), rgba(0, 0, 0, 0)), url('../assets/img/halftone.png');
            transform: rotate(30deg);
            position: absolute;
            top: -60%;
            right: -15%;
            z-index: -1;
        }
        .logo{
            width: 7vh;
            height: 7vh;
            position: absolute;
            top: 4vh;
            left: 4vh;
            display: flex;
            flex-direction: row;
            transform: translateY(10%);
            animation: logo 1s cubic-bezier(.5,0,.15,1) forwards;
            @keyframes logo {
                0%{transform: translateY(10%);opacity: 0;}
                100%{transform: translateY(0);opacity: 1;}
            }
            img{
                width: 100%;
                height: 100%;
            }
            .logo-title{
                margin-left: 1.5vh;
                height: 7vh;
                font: 2.5vh Gilroy-ExtraBold;
                color: rgba(255, 255, 255, 0.90);
                text-align: left;
                display: flex;
                flex-direction: column;
                justify-content: center;
            }
        }
        .update-animation{
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            opacity: 0.94;
            .update-icon-1{
                width: 35vh;
                height: 35vh;
                animation: update-icon-1 1.2s cubic-bezier(.5,0,.15,1) forwards;
                @keyframes update-icon-1 {
                    0%{transform: scale(3) rotate(0deg);opacity: 1;}
                    90%{transform: scale(1) rotate(180deg);opacity: 1;}
                    100%{transform: scale(0.9) rotate(180deg);opacity: 0;}
                }
            }
        }
        .update-content{
            height: 100%;
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: center;
            .update-img{
                width: 40vh;
                height: 40vh;
                opacity: 0.95;
                position: relative;
                transform: translate(0%, 130%);
                animation: update-img 1s 1s cubic-bezier(.5,0,.15,1) forwards;
                @keyframes update-img {
                    0%{transform: translate(0%, 130%);}
                    100%{transform: translate(0%, 30%)}
                }
                .ani-1, .ani-2, .ani-3{
                    width: 100%;
                    height: 100%;
                    position: absolute;
                    opacity: 0;
                }
                .ani-1{
                    transform: translateY(-30%);
                    animation: ani-1 1.8s 1.2s cubic-bezier(.5,0,.15,1) infinite;
                    @keyframes ani-1 {
                        0%{transform: translateY(-30%);opacity: 0;}
                        70%{transform: translateY(-45%);opacity: 0.2;}
                        100%{transform: translateY(-45%);opacity: 0;}
                    }
                }
                .ani-2{
                    transform: translateY(-45%);
                    animation: ani-2 1.8s 1.4s cubic-bezier(.5,0,.15,1) infinite;
                    @keyframes ani-2 {
                        0%{transform: translateY(-45%);opacity: 0;}
                        70%{transform: translateY(-55%);opacity: 0.2;}
                        100%{transform: translateY(-55%);opacity: 0;}
                    }
                }
                .update-icon-2{
                    width: 40vh;
                    height: 40vh;
                }
            }
            .update-info{
                margin-left: 6vh;
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                .update-title{
                    font: 9vh SourceHanSansCN-Heavy;
                    color: rgba(255, 255, 255, 0.95);
                    transform: translateX(10%);
                    opacity: 0;
                    animation: update-title 1s 1.2s cubic-bezier(.5,0,.15,1) forwards;
                    @keyframes update-title {
                        0%{transform: translateX(10%);opacity: 0;}
                        100%{transform: translateX(0);opacity: 1;}
                    }
                }
                .update-version{
                    display: flex;
                    flex-direction: row;
                    .update-title-en{
                        line-height: 6.4vh !important;
                        font: 6.4vh SourceHanSansCN-Heavy;
                        color: rgba(255, 255, 255, 0.95);
                        white-space: nowrap;
                        transform: translateX(10%);
                        opacity: 0;
                        animation: update-title-en 1s 1.1s cubic-bezier(.5,0,.15,1) forwards;
                        @keyframes update-title-en {
                            0%{transform: translateX(10%);opacity: 0;}
                            100%{transform: translateX(0);opacity: 1;}
                        }
                    }
                    .version{
                        margin-left: 1.2vh;
                        line-height: 6.4vh !important;
                        padding: 2px 6px;
                        font: 6.4vh SourceHanSansCN-Heavy;
                        // 同样需要 !important：白色滑入背景上的黑字在深色模式下会被 `.dark *` 冲掉
                        color: rgba(0, 0, 0, 0.95) !important;
                        position: relative;
                        overflow: hidden;
                        opacity: 0;
                        &::after{
                            content: '';
                            width: 100%;
                            height: 100%;
                            position: absolute;
                            top: 0;
                            left: -101%;
                            background-color: rgba(255, 255, 255, 0.95);
                            z-index: -1;
                            animation: version-back 0.6s 1.5s cubic-bezier(.5,0,.15,1) forwards;
                            @keyframes version-back {
                                0%{left: -101%;}
                                100%{left: 0%;}
                            }
                        }
                        animation: version 0.3s 1.5s cubic-bezier(.5,0,.15,1) forwards;
                        @keyframes version {
                            0%{opacity: 0;}
                            100%{opacity: 1;}
                        }
                    }
                }
                .update-option{
                    margin-top: 2.8vh;
                    display: flex;
                    flex-direction: row;
                    align-items: center;
                    overflow: hidden;
                    transform: translateY(30%);
                    opacity: 0;
                    animation: update-option 0.6s 1.6s cubic-bezier(.5,0,.15,1) forwards;
                    @keyframes update-option {
                        0%{transform: translateY(30%);opacity: 0;}
                        100%{transform: translateY(0);opacity: 1;}
                    }
                    .to-update, .close{
                        padding: 0.8vh;
                        font: 2vh SourceHanSansCN-Bold;
                        color: rgba(255, 255, 255, 0.95);
                        border: 1px solid white;
                        // 反色 hover 需要 !important：深色模式下 theme.css 的 `.dark *` 会把文字压回白色
                        &:hover{
                            background-color: rgba(255, 255, 255, 0.95);
                            color: black !important;
                            cursor: pointer;
                        }
                    }
                    .close{
                        margin-left: 16px;
                    }
                    .close-icon{
                        margin-left: 8px;
                        width: 3.6vh;
                        height: 3.6vh;
                    }
                }
            }
        }
    }
  }

  // 更新日志面板：容器展开、四角闪烁、水印与标题渐入均复用「添加到歌单」的动画节奏
  .update-changelog{
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.55);
    z-index: 10;
    // 裁剪放在遮罩层：容器保持 visible，四角装饰才能露出容器边缘
    overflow: hidden;
    .changelog-container{
      width: 0;
      height: 0;
      max-width: 92vw;
      max-height: 76vh;
      background-color: rgb(15, 15, 15);
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      animation: changelog-container-in 0.6s 0.3s forwards;
      @keyframes changelog-container-in {
        0%{width: 0;height: 0;}
        50%{width: 620px;height: 0;}
        100%{width: 620px;height: 460px;}
      }
      // 内容裁剪层：横向展开阶段容器高度为 0，内容需随之裁掉，
      // 四角装饰位于容器外侧（-4px），故不放进该层
      .changelog-body{
        width: 100%;
        height: 100%;
        position: relative;
        overflow: hidden;
      }
      .changelog-title{
        position: relative;
        z-index: 1;
        display: inline-block;
        padding: 10px 0;
        font: 16px SourceHanSansCN-Bold;
        color: white;
        opacity: 0;
        animation: changelog-title-in 0.3s 0.5s forwards;
        @keyframes changelog-title-in {
          0%{opacity: 0;}
          100%{opacity: 1;}
        }
      }
      .changelog-list{
        position: relative;
        z-index: 1;
        width: 100%;
        height: calc(100% - 96px);
        padding: 0 22px;
        overflow-y: auto;
        text-align: left;
        &::-webkit-scrollbar{
          width: 4px;
        }
        &::-webkit-scrollbar-thumb{
          background-color: rgba(255, 255, 255, 0.25);
        }
        .changelog-heading{
          margin: 8px 0 4px;
          font: 15px SourceHanSansCN-Bold;
          color: white;
        }
        .changelog-bullet{
          padding-left: 12px;
          font: 13px SourceHanSansCN-Bold;
          color: rgba(255, 255, 255, 0.85);
          line-height: 1.7;
          &::before{
            content: '>';
            margin-right: 6px;
            color: rgba(255, 255, 255, 0.5);
          }
        }
        .changelog-text{
          font: 13px SourceHanSansCN-Bold;
          color: rgba(255, 255, 255, 0.85);
          line-height: 1.7;
        }
        .changelog-gap{
          height: 6px;
        }
        .changelog-empty{
          padding-top: 20px;
          font: 13px SourceHanSansCN-Bold;
          color: rgba(255, 255, 255, 0.6);
        }
      }
      .changelog-footer{
        position: absolute;
        z-index: 1;
        left: 0;
        bottom: 0;
        width: 100%;
        padding: 0 0 12px;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        // 与标题同一时序：内容在容器长高时才被揭示，无需额外延迟
        opacity: 0;
        animation: changelog-footer-in 0.3s 0.5s forwards;
        @keyframes changelog-footer-in {
          0%{opacity: 0;}
          100%{opacity: 1;}
        }
        .changelog-github, .changelog-back{
          padding: 0.6vh 1.6vh;
          font: 13px SourceHanSansCN-Bold;
          color: rgba(255, 255, 255, 0.95);
          border: 1px solid white;
          // 反色 hover 同样补 !important，避免深色模式下文字被压回白色
          &:hover{
            background-color: rgba(255, 255, 255, 0.95);
            color: black !important;
            cursor: pointer;
          }
        }
        .changelog-back{
          margin-left: 16px;
        }
      }
      .changelog-style{
        width: 9px;
        height: 9px;
        background-color: rgb(247, 247, 247);
        position: absolute;
        opacity: 0;
        animation: changelog-style-in 0.4s forwards;
        @keyframes changelog-style-in {
          0%{opacity: 0;}
          10%{opacity: 1;}
          20%{opacity: 0;}
          30%{opacity: 1;}
          40%{opacity: 0;}
          50%{opacity: 1;}
          60%{opacity: 0;}
          70%{opacity: 1;}
          80%{opacity: 0;}
          90%{opacity: 0;}
          100%{opacity: 1;}
        }
      }
      $changelogPosition: -4px;
      .changelog-style1{
        top: $changelogPosition;
        left: $changelogPosition;
      }
      .changelog-style2{
        top: $changelogPosition;
        right: $changelogPosition;
      }
      .changelog-style3{
        bottom: $changelogPosition;
        right: $changelogPosition;
      }
      .changelog-style4{
        bottom: $changelogPosition;
        left: $changelogPosition;
      }
      .changelog-style5{
        font: 55px Gilroy-ExtraBold;
        color: rgba(255, 255, 255, 0.08);
        position: absolute;
        top: 10px;
        left: 20px;
        z-index: -1;
        opacity: 0;
        animation: changelog-style5-in 0.3s 0.6s forwards;
        @keyframes changelog-style5-in {
          0%{opacity: 0;}
          100%{opacity: 1;}
        }
      }
    }
  }
</style>