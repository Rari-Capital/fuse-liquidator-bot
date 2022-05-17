# DEPRECATED => moved to `monorepo/packages/fuse-liquidator-bot`

# Fuse by Rari Capital: Liquidator Bot

This repository contains the JavaScript source code for the Fuse Liquidator Bot. See [here for the Fuse dApp](https://github.com/Rari-Capital/fuse-dapp), [here for the Fuse SDK](https://github.com/Rari-Capital/fuse-sdk), or [here for the Fuse contracts](https://github.com/Rari-Capital/fuse-contracts).

## How it works

When running a Fuse pool, you need a bot to liquidate unhealthy loans. Fortunately, [Fuse's Safe Liquidator contract](https://github.com/Rari-Capital/fuse-contracts/blob/master/contracts/FuseSafeLiquidator.sol) allows liquidators to safely liquidate loans on any Fuse Pool by confirming on-chain that the liquidator will not lose money on each liquidation, so you will likely have external liquidators working for you. However, you may want to spin up a liquidator bot for profit or to improve the efficency of your own pool(s). Note that liquidations require ETH for gas, but you can set a minimum profit amount for your liquidations.

## Installation

You'll want to run the script on the latest Node.js LTS (tested with v12.16.1) with the latest version of NPM.

Install PM2 (process manager) globally: `npm i -g pm2`

Install `fuse-liquidator-bot` dependencies: `npm i` or `npm install`

## Usage

Configure your environment in `ecosystem.config.js`.

Start the rebalancer with PM2: `pm2 start ecosystem.config.js` (for production usage, add `--env production`)

Stop with PM2: `pm2 stop ecosystem.config.js`

Check process status with PM2: `pm2 list`

Find PM2 logs in `~/.pm2/logs`.

## Credits

Fuse is developed by [David Lucid](https://github.com/davidlucid) of Rari Capital. Find out more about Rari Capital at [rari.capital](https://rari.capital).
