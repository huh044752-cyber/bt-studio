import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

export interface PageMeta {
  title: string;
  group: string;
  icon: string;
}

// 侧栏顺序:工作空间 → 类型与数据 → 行为树/状态机设计 → 场景挂接
// 分组标题按用户要求:group 名 = 侧栏标签(单项组时组名即入口)。
const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/project" },
  {
    path: "/project",
    component: () => import("@/pages/ProjectWorkspacePage.vue"),
    meta: { title: "工作空间", group: "工作空间", icon: "pkg" } satisfies PageMeta,
  },
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
  {
    path: "/design",
    component: () => import("@/pages/DesignPage.vue"),
    meta: { title: "行为树 / 状态机", group: "行为树 / 状态机设计", icon: "tree" } satisfies PageMeta,
  },
  {
    path: "/scenario",
    component: () => import("@/pages/ScenarioAttachPage.vue"),
    meta: { title: "场景挂接", group: "场景挂接", icon: "link" } satisfies PageMeta,
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

export const navRoutes = routes.filter((r) => r.meta) as (RouteRecordRaw & { meta: PageMeta })[];
