/**
 * better-sqlite3 浏览器/打包占位：
 * @ngageoint/geopackage 在 Node 下优先尝试原生 better-sqlite3（可选依赖）。
 * 浏览器与本项目的一体化打包不支持原生模块，用此 stub 顶替 require，
 * 使库在 try/catch 中回退到纯 WASM 的 SqljsAdapter。
 */
throw new Error('better-sqlite3 不可用（浏览器/打包环境），回退 sql.js WASM')
