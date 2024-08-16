import { HardhatUserConfig, task } from 'hardhat/config'
import fs from 'fs'
import * as envfile from 'envfile'

task('registry', 'Deploys contracts with custom parameters')
  .addOptionalParam('name', 'The domain name to register')
  .addOptionalParam('address', 'Domain owner address')
  .setAction(async ({ name, address }, hre) => {
    const { ethers } = hre
    const ensRegistry = await ethers.getContract('ENSRegistry')
    const { owner } = await hre.getNamedAccounts()

    if (
      (await ensRegistry.owner(ethers.utils.namehash('resolver.eth'))) === owner
    ) {
      const addr = await ensRegistry.resolver(
        ethers.utils.namehash('resolver.eth'),
      )
      const publicResolver = await (
        await ethers.getContractFactory('PublicResolver')
      ).attach(addr)

      console.log(`resolver.eth=======>>> PublicResolverAddress :(${addr})...`)

      console.log(
        `====================domainName register=======================`,
      )
      const domainNameToUse = name || 'defaultDomain'
      const ownerAddress =
        address || '0xb41981438e18A686E571f5f5f38eA6b357d83dfe'
      const duration = 31536000
      const secret = ethers.utils.hexlify(ethers.utils.randomBytes(32))
      const resolverAddress = addr
      await registerDomain(
        ethers,
        domainNameToUse,
        ownerAddress,
        duration,
        secret,
        resolverAddress,
        publicResolver,
      )

      const domain_ResolverAddress = await ensRegistry.resolver(
        ethers.utils.namehash(`${domainNameToUse}.eth`),
      )
      const pr = await (
        await ethers.getContractFactory('PublicResolver')
      ).attach(domain_ResolverAddress)
      console.log(
        `${name}.eth=======>>>ResolverAddress :(${domain_ResolverAddress})...`,
      )
      const ret = await pr['addr(bytes32)'](
        ethers.utils.namehash(`${domainNameToUse}.eth`),
      )
      console.log(`${domainNameToUse}.eth Resolution address :(${ret})`)
    } else {
      console.log(
        'resolver.eth is not owned by the owner address, not setting resolver',
      )
    }
  })

async function registerDomain(
  ethers: any,
  domainName: any,
  ownerAddress: any,
  duration: any,
  secret: any,
  resolverAddress: any,
  publicResolver: any,
) {
  // 获取 ETHRegistrarController 合约实例
  // const ethRegistrarController = await ethers.getContract("ETHRegistrarController");
  const ethRegistrarController = await ethers.getContract(
    'ETHRegistrarController',
  )

  console.log(await ethRegistrarController.available)
  // 检查域名是否可用
  const isAvailable = await ethRegistrarController.available(domainName)
  if (!isAvailable) {
    console.log(`Domain ${domainName}.eth is not available.`)
    return
  }
  console.log(`Domain ${domainName}.eth is available.`)

  // 计算注册费用
  const price = await ethRegistrarController.rentPrice(domainName, duration)
  // 检查 price 是否有效
  if (price && ethers.BigNumber.isBigNumber(price.base)) {
    const formattedPrice = ethers.utils.formatEther(price.base)
    console.log(
      `Rent price for ${domainName}.eth for ${
        duration / 31536000
      } year(s) is: ${formattedPrice} ETH`,
    )
  } else {
    console.error('Price returned is not a valid BigNumber:', price.base)
  }

  // 生成设置地址记录的调用数据
  const setAddrData = publicResolver.interface.encodeFunctionData(
    'setAddr(bytes32,address)',
    [ethers.utils.namehash(`${domainName}.eth`), ownerAddress],
  )
  console.log('setAddrData', setAddrData)

  // 提交承诺（防止抢注）
  const commitment = await ethRegistrarController.makeCommitment(
    domainName,
    ownerAddress,
    duration,
    secret,
    resolverAddress,
    [setAddrData],
    true,
    0,
  )
  await ethRegistrarController.commit(commitment)
  console.log(`Commitment for ${domainName}.eth submitted.`)

  // 等待承诺生效（根据部署控制器最小时间 ，目前是1秒生效）
  console.log(
    'Waiting for the commitment to be valid (typically 60 seconds)...',
  )
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // 注册域名
  const tx = await ethRegistrarController.register(
    domainName,
    ownerAddress,
    duration,
    secret,
    resolverAddress,
    [setAddrData],
    true,
    0,
    {
      value: price.base.add(price.premium),
    },
  )
  console.log(
    `Domain ${domainName}.eth registration transaction submitted (tx: ${tx.hash}).`,
  )
  // 等待交易确认
  await tx.wait()
  console.log(
    `Domain ${domainName}.eth successfully registered to ${ownerAddress}.`,
  )
}
