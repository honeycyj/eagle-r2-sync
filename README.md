# R2 发布

Eagle 4 的 macOS 插件：自动将指定 Eagle 文件夹及子文件夹中的图片、视频发布到 Cloudflare R2。在文件详情中查看状态、复制公开链接。支持 Intel 与 Apple Silicon。

## 安装

[直接下载安装包](https://github.com/honeycyj/eagle-r2-sync/releases/latest/download/Honeycyj-R2-Sync-0.6.3.eagleplugin) · [全部版本与备用包](https://github.com/honeycyj/eagle-r2-sync/releases)

1. 下载并双击 `Honeycyj-R2-Sync-0.6.3.eagleplugin`。无需安装 Node.js 或开发工具。
2. 在 Eagle 插件菜单打开「R2 发布」。首次使用没有预填账户、桶、域名或密钥，也不会自动启用同步。
3. 添加需要同步的 Eagle 文件夹；包括其所有子文件夹，可添加多个、停用或移除，修改后保存生效。一个配置绑定一个资源库。
4. 打开上传服务设置，填写 **Account ID、桶名、公开域名、发布目录、Access Key ID、Secret Access Key**。公开域名例如 `https://img.example.com`，需要提前在 R2 配好自定义域名与访问方式。
5. 选择图片压缩方式。弹窗「完成」暂存修改，主面板「保存设置」才写入本机。保存后启用同步。
6. 在同步范围内选中图片或视频，在 Eagle 详情中复制已发布链接。关闭设置窗口仍在后台运行，退出 Eagle 后停止。

凭据只在用户自己的机器输入，不需要发给插件作者。R2 凭据应仅授权所需桶的对象读写；开启同步删除还需要删除权限。API 的 Account ID 与 R2 S3 凭据不是同一个字段。

保存时两项 R2 密钥留空会保留已有凭据，替换时需成对填写。支持显示核对与移除本机凭据；移除会暂停同步，不删除 R2 文件。

## 同步与链接

- 每 3 秒检查一次；新增文件稳定至少 3 秒后处理，通常约 3–6 秒发现，排队时更久。
- 同一资源库中的同一 Eagle 项目，只要内容没有改变，改名、移到子文件夹或在启用目录间移动，都沿用对象和链接，不重新上传。
- 重叠目录只处理一次。重新导入为新 Eagle 项目会独立上传，不会通过相似度或文件名认领旧对象。
- 内容改变时发布新版本，不覆盖已有公开 URL。单纯切换压缩档位或服务不会重新上传已发布的内容。
- 普通网络失败自动退避重试；权限、额度等错误等待修复后手动重试。设置页仅在失败时显示原因和重试入口。

## 图片与视频

本地压缩使用 Eagle 内置 Chromium 的 WebP 编码器，保持原宽高、不修改 Eagle 原图：

| 选项 | 处理 |
| --- | --- |
| 不压缩 | 原格式副本上传 |
| 轻度 | WebP 质量 0.92 |
| 标准 | WebP 质量 0.82 |
| 较高压缩 | WebP 质量 0.65 |
| TinyPNG | 用户自行配置 API Key，并授权将图片发送给该服务 |

转换后更大时回退原格式副本。压缩结果仅保留在内存，成功或失败后释放，不生成磁盘图片缓存。本地支持 JPG/JPEG、PNG、静态 WebP、BMP；TinyPNG 支持 JPG/JPEG、PNG、静态 WebP。图片上限 80 MiB / 8000 万像素，动态图片、SVG、HEIC、RAW 等暂不发布。

TinyPNG 使用官方 `api.tinify.com`，额外消耗网络与服务额度。插件校验结果尺寸，不主动改变宽高。WebP 转换可能改变颜色表现及元数据，原格式直传可能保留原文件元数据。

视频原格式流式上传，**不压缩、不转码**，单次 PUT 上限 5 GiB。支持 MP4、M4V、MOV、WebM、MKV、AVI、MPEG/MPG、3GP、OGV、TS/MTS/M2TS、WMV、FLV；能否网页播放还取决于视频编码和浏览器。暂不支持分片上传或断点续传。

## 可选：七天缓冲删除

默认关闭。在上传设置中勾选「同步删除到云端（保留 7 天）」后，以 Eagle 为主执行单向镜像：

| 场景 | 行为 |
| --- | --- |
| 删除到 Eagle 回收站或移出全部启用目录 | 两次健康扫描确认后进入七天缓冲 |
| 缓冲期内恢复原项目或移回同步目录 | 取消删除；内容没变仍使用原链接 |
| 修改内容且新版本上传成功 | 可核实的旧版本进入七天缓冲 |
| 七天到期 | 再次核对 Eagle 项目、范围、配置和云端对象，符合条件才删除 |
| 暂停、停用/取消目录、关闭镜像 | 不清空云端，取消计划；重新启用后重新确认与计时 |
| 库离线、根目录缺失、API 读取失败 | 停止删除，不推断内容已经移除 |

有待删除对象时才显示列表，可查看原因、剩余时间或选择「保留云端」。保留会排除此对象的后续自动删除；由后台下一轮处理，已发出的删除请求无法撤回。Eagle 关闭时不执行到期清理，恢复后检查再处理。

只清理本插件明确记录、属于当前命名空间且能核实的对象，不扫描整桶、不清理其他工具文件。旧映射缺少历史归属或目标记录时不会自动接管删除。删除结果不明或已删除的项目恢复时，会使用新版本键重新发布。

**删除后公开链接可能失效。** R2 源站删除不会主动清空浏览器或 CDN 缓存。删除前先核对 ETag；旧记录没有 ETag 时可能额外下载一次对象核对 SHA-256。核对与删除不是原子锁：外部工具不要并发覆盖插件随机命名空间。不要同时运行主包和备用后台包，也不支持多个后台实例共同管理一个配置。

## 本地数据与隐私

- 非密钥配置与发布映射保存在 `~/Library/Application Support/Honeycyj Eagle R2/`，包括历史版本与删除计划；写入时使用 0600 权限。
- R2 / TinyPNG 密钥保存在 macOS 钥匙串，服务名 `com.honeycyj.eagle-r2`。这些产品标识保留用于兼容已有安装，安装包不包含用户数据。
- 不包含作者的账户、桶名、个人域名、资源库路径、发布映射或密钥。不包含遥测或分析 SDK。
- 通用钥匙串助手随包提供，支持 Intel / ARM，ad-hoc 签名、未 Apple 公证；无需关闭系统安全保护。

## SDK 与运行限制

service 与 Inspector 组合入口已经在 macOS Eagle 中运行验证。范围外详情正文隐藏；官方 SDK 没有隐藏 Inspector 原生外层标题的接口。文件夹选择为自有面板，支持读取 Eagle 当前选择；不能直接调用 Eagle 内部的文件夹筛选器。库路径改变需要重新绑定。

备用安装包位于 `fallback/`，只在组合入口不兼容时使用：先停用主包，再安装 Background 和 Inspector 两包，避免重复后台实例。

## 开发与构建

Node.js 18+、Python 3、macOS。运行时无 npm 依赖；开发测试使用 Electron 22，以匹配插件运行环境，不是建议将该旧版 Electron 用于新的独立应用。

```sh
npm ci
npm test
npm run test:package
npm run test:browser
python3 build.py
```

构建结果在 `dist/`：主 `.eagleplugin`、备用包、源码 ZIP、`SHA256SUMS.txt`。构建采用明确文件清单，不递归打包工程中的未知文件；源码包与插件包均排除配置、状态、密钥、测试日志、临时截图和依赖目录。在构建输出目录内校验安装包：

```sh
cd dist
shasum -a 256 -c SHA256SUMS.txt
```

重建 macOS 钥匙串助手需要 Xcode Command Line Tools：

```sh
xcrun clang -arch arm64 -arch x86_64 -mmacosx-version-min=11.0 src/keychain.c -framework Security -framework CoreFoundation -o plugin/bin/keychain
codesign --force --sign - --identifier com.honeycyj.eagle-r2.keychain plugin/bin/keychain
```

测试覆盖范围与真实运行限制见 [TEST-RESULTS.md](TEST-RESULTS.md)。参考 [Eagle SDK](https://developer.eagle.cool/plugin-api/api/folder)、[Cloudflare R2](https://developers.cloudflare.com/r2/) 和 [Dropline](https://github.com/chen86860/dropline) 的后台职责划分，没有移植 Swift；上游 MIT 声明保留在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
