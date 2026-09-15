/** 固定并发跑异步任务（批量 embed / 取消 / 删除用） */
export async function runPool<T>(list: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0
  const lane = async () => {
    while (i < list.length) await fn(list[i++])
  }
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, lane))
}
