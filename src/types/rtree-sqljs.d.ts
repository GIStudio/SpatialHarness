/**
 * rtree-sql.js（sql.js 的 R-Tree 分支，GeoPackage 空间索引所需）无类型声明。
 * initSqlJs(config) 返回 Promise<SQL.Module>；此处声明用到的最小面。
 */
declare module 'rtree-sql.js' {
  export interface SqlJsConfig {
    locateFile?: (file: string) => string
    wasmBinary?: Uint8Array | ArrayBuffer
  }
  export interface SqlJsModule {
    Database: new (data?: Uint8Array | null) => unknown
  }
  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsModule>
}
