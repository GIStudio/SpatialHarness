/**
 * shpjs 无官方类型声明，这里做最小声明。
 * 实际使用面：parseShp / parseDbf / combine（详见 node_modules/shpjs/lib/index.js）。
 */
declare module 'shpjs' {
  const shp: any
  export default shp
}
