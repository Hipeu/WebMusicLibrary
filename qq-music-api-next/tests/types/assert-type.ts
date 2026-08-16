/**
 * 利用 TypeScript 的类型系统进行静态断言。
 * 只有当传入的类型参数 `T` 为 `true` 时，编译才会通过。
 */
export function assertType<_T extends true>() {}
