import { createRouter, createWebHashHistory } from 'vue-router'
import { isLogin } from '../utils/authority'
import { noticeOpen } from '../utils/dialog'
import { ensureDeferredAppInit } from '../utils/initApp'
import { runIdleTask } from '../utils/player/idleTask'
import { useUserStore } from '../store/userStore'
import { useLibraryStore } from '../store/libraryStore'
import { storeToRefs } from 'pinia'
import { useOtherStore } from '../store/otherStore'
import { hasAnyMusicAccount, hasQQAccount } from '../utils/accountProviders.mjs'
import { canAccessQQMyMusic, getSearchSource } from '../utils/providerPolicy.mjs'

function createRouteLoader(loader) {
    let promise = null
    return () => {
        if (!promise) {
            promise = loader().catch(error => {
                promise = null
                throw error
            })
        }
        return promise
    }
}

// 路由组件保持懒加载，同时支持首屏后空闲预热
const HomePage = createRouteLoader(() => import('../views/HomePage.vue'))
const CloudDisk = createRouteLoader(() => import('../views/CloudDisk.vue'))
const PersonalFMPage = createRouteLoader(() => import('../views/PersonalFMPage.vue'))
const LoginPage = createRouteLoader(() => import('../views/LoginPage.vue'))
const LoginContent = createRouteLoader(() => import('../components/LoginContent.vue'))
const MyMusic = createRouteLoader(() => import('../views/MyMusic.vue'))
const SirenPage = createRouteLoader(() => import('../views/SirenPage.vue'))
const LibraryDetail = createRouteLoader(() => import('../components/LibraryDetail.vue'))
const RecommendSongs = createRouteLoader(() => import('../components/RecommendSongs.vue'))
const SearchResult = createRouteLoader(() => import('../views/SearchResult.vue'))
const Settings = createRouteLoader(() => import('../views/Settings.vue'))
const RadioDetail = createRouteLoader(() => import('../components/RadioDetail.vue'))

const userStore = useUserStore()
const libraryStore = useLibraryStore()
const { updateLibraryDetail } = libraryStore
const { libraryInfo } = storeToRefs(libraryStore)
const hasDifferentLibraryId = (to, from) => String(to?.params?.id || '') != String(from?.params?.id || '')
const hasDifferentLibrarySource = (to, from) => String(to?.query?.source || 'netease') != String(from?.query?.source || 'netease')
//先完成路由跳转再拉详情数据，避免点击后要等网络请求才有反应
const enterLibraryDetail = (to, from, next, routeName, options = {}) => {
    const needReload = !libraryInfo.value || from.name != routeName || hasDifferentLibraryId(to, from) || hasDifferentLibrarySource(to, from)
    next()
    if (!needReload) return
    updateLibraryDetail(to.params.id, routeName, options).catch(() => {
        libraryStore.libraryChangeAnimation = false
        noticeOpen('加载失败', 2)
    })
}
const routeComponentPreloadLoaders = [
    HomePage,
    MyMusic,
    CloudDisk,
    PersonalFMPage,
    LibraryDetail,
    RecommendSongs,
    RadioDetail,
    SearchResult,
    Settings,
    SirenPage,
    LoginPage,
    LoginContent,
]
const routeComponentPreloadBatchSize = 2
let routeComponentPreloadStarted = false

async function preloadRouteComponentBatch(startIndex = 0) {
    if (typeof window === 'undefined' || startIndex >= routeComponentPreloadLoaders.length) return

    await runIdleTask(async () => {
        const batch = routeComponentPreloadLoaders.slice(
            startIndex,
            startIndex + routeComponentPreloadBatchSize
        )
        await Promise.allSettled(batch.map(loader => loader()))
    }, { timeout: 1500, fallbackDelay: 700 })

    void preloadRouteComponentBatch(startIndex + routeComponentPreloadBatchSize)
}

function scheduleRouteComponentPreload() {
    if (routeComponentPreloadStarted || typeof window === 'undefined') return
    routeComponentPreloadStarted = true
    void preloadRouteComponentBatch()
}

const routes = [
    {
        path: '/',
        name: 'homepage',
        component: HomePage,
        beforeEnter: (to, from, next) => {
            if(!userStore.homePage) next({name: 'mymusic'})
            else next()
        },
    },
    {
        path: '/cloud',
        name: 'clouddisk',
        component: CloudDisk,
        beforeEnter: (to, from, next) => {
            if(!userStore.cloudDiskPage) next({name: 'mymusic'})
            else if(isLogin()) next()
            else {next({name: 'login'});noticeOpen("请先登录", 2)}
        },
    },
    {
        path: '/login',
        name: 'login',
        component: LoginPage
    },
    {
        path: '/siren',
        name: 'siren',
        component: SirenPage,
    },
    {
        path: '/siren/album/:id',
        name: 'sirenAlbum',
        component: SirenPage,
    },
    {
        path: '/mymusic',
        name: 'mymusic',
        component: MyMusic,
        children: [
            {
                path: '/mymusic/playlist/:id',
                name: 'playlist',
                component: LibraryDetail,
                beforeEnter: (to, from, next) => {
                    const source = String(to.query.source || 'netease').toLowerCase()
                    if (!canAccessQQMyMusic(source, hasQQAccount())) {
                        noticeOpen('请先登录 QQ 音乐', 2)
                        next({ name: 'mymusic' })
                        return
                    }
                    enterLibraryDetail(to, from, next, 'playlist', { deferRemaining: true, source })
                }
            },
            {
                path: '/mymusic/album/:id',
                name: 'album',
                component: LibraryDetail,
                beforeEnter: (to, from, next) => {
                    if (String(to.query.source || '').toLowerCase() === 'qq') {
                        noticeOpen('QQ 音乐暂不支持专辑详情', 2)
                        next({ name: 'mymusic' })
                        return
                    }
                    enterLibraryDetail(to, from, next, 'album', { source: 'netease' })
                }
            },
            {
                path: '/mymusic/artist/:id',
                name: 'artist',
                component: LibraryDetail,
                beforeEnter: (to, from, next) => {
                    if (String(to.query.source || '').toLowerCase() === 'qq') {
                        noticeOpen('QQ 音乐暂不支持歌手详情', 2)
                        next({ name: 'mymusic' })
                        return
                    }
                    enterLibraryDetail(to, from, next, 'artist', { source: 'netease' })
                }
            },
            {
                path: '/mymusic/playlist/rec',
                name: 'rec',
                component: RecommendSongs,
                beforeEnter: (to, from, next) => {
                    if(isLogin()) {
                        next()
                    } else {
                        noticeOpen(hasQQAccount() ? 'QQ 音乐不提供每日推荐' : '请先登录网易云音乐', 2)
                        next({name: hasQQAccount() ? 'mymusic' : 'login'})
                    }
                }
            },
            {
                path: '/mymusic/dj/:id',
                name: 'dj',
                component: RadioDetail,
            },
        ],
        beforeEnter: (to, from, next) => {
            if(hasAnyMusicAccount()) next()
            else if((from.name == 'homepage' || from.name == 'search') && to.fullPath != '/mymusic') next()
            else next({name: 'login'})
        },
    },
    {
        path: '/personalfm',
        name: 'personalfm',
        component: PersonalFMPage,
        beforeEnter: (to, from, next) => {
            if(isLogin()) {
                next()
            } else {
                noticeOpen("请先登录", 2)
                next({name: 'login'})
            }
        }
    },
    {
        path: '/login/account',
        name: 'account',
        component: LoginContent
    },
    {
        path: '/library',
        name: 'library',
        component: LibraryDetail
    },
    {
        path: '/search',
        name: 'search',
        component: SearchResult,
        beforeEnter: (to, from, next) => {
            const searchStore = useOtherStore()
            searchStore.searchSource = getSearchSource()
            searchStore.getSearchInfo(to.query.keywords)
            next()
        }
    },
    {
        path: '/settings',
        name: 'settings',
        component: Settings,
        beforeEnter: (to, from, next) => {
            next()
        }
    },
]

const router = createRouter({
    history: createWebHashHistory(),
    routes,
})

router.beforeEach((to, from, next) => {
    const fullPath = typeof to?.fullPath === 'string' ? to.fullPath : ''
    const shouldWarmDeferredInit = fullPath.startsWith('/mymusic')
        || fullPath.startsWith('/cloud')
        || fullPath.startsWith('/personalfm')
        || fullPath.startsWith('/siren')

    if (shouldWarmDeferredInit) {
        void ensureDeferredAppInit()
    }

    next()
})

router.afterEach(() => {
    scheduleRouteComponentPreload()
})

export default router
