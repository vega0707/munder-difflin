# ARCHITECTURE — Strategy C

规格驱动。运行时建议形态与 B 类似（TS daemon），但 **禁止** 依赖上游源码树。

```
specs (本仓 docs) → spikes → 未来实现仓
```

实现可日后合并进 munder-difflin 或独立 `munder-fleet` 应用仓；本仓保持「真相来源」。
