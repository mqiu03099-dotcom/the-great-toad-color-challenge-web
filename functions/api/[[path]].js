// 本地 `wrangler pages dev` 用的入口；线上走 worker/index.js，逻辑共用 worker/api.js
import { handleApi } from "../../worker/api.js";

export const onRequest = ({ request, env }) => handleApi(request, env);