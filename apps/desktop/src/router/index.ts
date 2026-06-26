import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

export interface PageMeta {
  title: string;
  group: string;
  icon: string;
}

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/project" },
  // 工程:工作空间是企业级别的入口(新建/打开/配置/生成),放最前。
  {
    path: "/project",
    component: () => import("@/pages/ProjectWorkspacePage.vue"),
    meta: { title: "工作空间", group: "工程", icon: "pkg" } satisfies PageMeta,
  },
  // 设计:行为树/状态机编辑。
  {
    path: "/design",
    component: () => import("@/pages/DesignPage.vue"),
    meta: { title: "行为树设计", group: "设计", icon: "tree" } satisfies PageMeta,
  },
  // 类型与数据:类型空间(Agent/方法/枚举)+ 黑板中心(运行变量)。
  {
    path: "/model-workspace",
    component: () => import("@/pages/ModelWorkspacePage.vue"),
    meta: { title: "类型空间", group: "类型与数据", icon: "model" } satisfies PageMeta,
  },
  {
    path: "/variables",
    component: () => import("@/pages/VariablesPage.vue"),
    meta: { title: "黑板中心", group: "类型与数据", icon: "var" } satisfies PageMeta,
  },
  // 运行:场景挂接(校验/问题总览已并入「行为树设计 → 问题」面板,故移除独立"运行调试"页)。
  {
    path: "/scenario",
    component: () => import("@/pages/ScenarioAttachPage.vue"),
    meta: { title: "场景挂接", group: "运行", icon: "link" } satisfies PageMeta,
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

export const navRoutes = routes.filter((r) => r.meta) as (RouteRecordRaw & { meta: PageMeta })[];
