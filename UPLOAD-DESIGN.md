# 后台上传参考与取舍

检查 Dropline 提交 `43b0f953b6d34fe2f0a87316d148ee7692571d65`，仅研究后台实现，没有搬入 Swift 代码或界面。

| Dropline 实现 | 本插件采用方式 |
| --- | --- |
| S3Signer 流式计算文件 SHA-256，UploadService 从文件上传 | 视频流式计算 SHA-256 / MD5，从 Eagle 原文件上传；图片处理后仍用内存 Buffer |
| 共享 URLSession，60 秒请求超时、1 小时资源超时 | 共享 HTTPS Agent，60 秒网络无响应超时、1 小时总超时 |
| defer 关闭句柄、删除上传临时表单文件 | 所有结果路径销毁文件流；图片 Buffer 清零；不创建压缩图片/视频缓存 |
| AppState 的 waiting / uploading / done / failed 队列与并发上限 | 保留串行工作队列，控制图片解码内存；记录处理、进度、失败与链接，自动扫描入队 |

Dropline 的 enqueue 会展开文件夹并提交任务，所检查代码没有 Eagle 文件夹监听逻辑；不能直接提供本插件的自动同步。插件仍每 3 秒检测授权目录，等待文件稳定，复查目录归属，并以内容摘要去重。重启后重新扫描并从持久化映射恢复，网络失败退避重试；认证错误等待修复。设置变化不会自动重发已发布内容。

Dropline 的 multipart/form-data 临时表单与 S3 Multipart Upload 是不同机制。本插件当前单次 PUT，上限 5 GiB，无断点续传。大视频后续应单独设计 R2 分片会话持久化、失败分片重试和未完成会话清理，不能把表单实现当作分片上传。

原链接不覆盖；历史对象默认保留，用户开启镜像后，按七天缓冲规则核实并清理。暂停时停止后续任务，已发出的请求可能完成；暂未提供用户取消在途请求功能。

源码依据：[UploadService.swift](https://github.com/chen86860/dropline/blob/43b0f953b6d34fe2f0a87316d148ee7692571d65/Sources/Dropline/UploadService.swift)、[S3Signer.swift](https://github.com/chen86860/dropline/blob/43b0f953b6d34fe2f0a87316d148ee7692571d65/Sources/Dropline/S3Signer.swift)、[AppState.swift](https://github.com/chen86860/dropline/blob/43b0f953b6d34fe2f0a87316d148ee7692571d65/Sources/Dropline/AppState.swift)。MIT 声明保留于 THIRD_PARTY_NOTICES.md。
