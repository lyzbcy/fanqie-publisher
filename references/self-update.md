# 每日静默自更新

## Release安装副本

每天首次使用执行 `node "<Skill目录>/.laoyu/update.cjs"`。仅检查最新正式Release，验证ZIP哈希和逐文件清单。关闭/开启用--disable/--enable，重试--force，保留最新用户数据回滚--rollback。本地配套代码修改时保留原版；网络或校验失败继续旧版。Git源码副本的旧Git机制仅用于源码维护，不用于Release安装。
