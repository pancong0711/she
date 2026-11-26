# SHE companion 0.4.0 发布说明

> Release：`v0.4.0-companion.1`
> 日期：2026-11-26

## 新增

- Package Docker 安装指引增加国内镜像备用方案：
  - 阿里云 Docker CE；
  - 清华 TUNA Docker CE；
  - 中科大 USTC Docker CE；
- 每个镜像方案提供完整逐步命令与解释；
- 必须校验 Docker 官方 GPG 指纹：
  ```text
  9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88
  ```
- 仍然只推荐 rootless Docker，不加入 root docker 组。

## 说明

镜像只替换 apt 仓库/GPG 下载地址；`docker pull` 的 registry mirror 仍需单独配置。
