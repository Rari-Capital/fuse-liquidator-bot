module.exports = {
  apps: [
    {
      name: 'fuse-liquidator-bot',
      script: 'node',
      args: 'build/fuse-liquidator-bot/index.js',

      // Options reference: https://pm2.keymetrics.io/docs/usage/application-declaration/
      // args: 'one two',
      // instances: 1,
      // autorestart: true,
      // watch: false,
      // max_memory_restart: '1G',
      time: true,
      env: {
        NODE_ENV: 'development',
        LIQUIDATION_STRATEGY: 'uniswap', // "" for safe liquidation using your own capital or "uniswap" for safe liquidation using Uniswap flash swaps
        SUPPORT_ALL_PUBLIC_POOLS: true, // Set to true to perform liquidations for all public Fuse pools (not a security risk as FuseSafeLiquidator makes sure you seize at least X or profit at least X)
        SUPPORTED_POOL_COMPTROLLERS: '', // Supported pool Comptroller proxy (Unitroller) addresses; if SUPPORT_ALL_PUBLIC_POOLS is true, supports these pools as well as all public Fuse pools
        MINIMUM_PROFIT_NATIVE: 0, // 0 = break even in worst case scenario
        LIQUIDATION_INTERVAL_SECONDS: 5,
      },
      env_production: {
        NODE_ENV: 'production',
        LIQUIDATION_STRATEGY: '', // "" for safe liquidation using your own capital or "uniswap" for safe liquidation using Uniswap flash swaps
        SUPPORT_ALL_PUBLIC_POOLS: true, // Set to true to perform liquidations for all public Fuse pools (not a security risk as FuseSafeLiquidator makes sure you seize at least X or profit at least X)
        SUPPORTED_POOL_COMPTROLLERS: '', // Supported pool Comptroller proxy (Unitroller) addresses; if SUPPORT_ALL_PUBLIC_POOLS is true, supports these pools as well as all public Fuse pools
        MINIMUM_PROFIT_NATIVE: 0, // 0 = break even in worst case scenario
        LIQUIDATION_INTERVAL_SECONDS: 30,
      },
    },
  ],
};
