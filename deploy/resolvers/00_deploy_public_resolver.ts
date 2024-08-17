import { namehash } from 'ethers/lib/utils'
import { ethers } from 'hardhat'
import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, deployments } = hre
  const { deploy } = deployments
  const { deployer, owner } = await getNamedAccounts()

  const registry = await ethers.getContract('ENSRegistry', owner)
  const nameWrapper = await ethers.getContract('NameWrapper', owner)
  const controller = await ethers.getContract('ETHRegistrarController', owner)
  const reverseRegistrar = await ethers.getContract('ReverseRegistrar', owner)

  const deployArgs = {
    from: deployer,
    args: [
      registry.address,
      nameWrapper.address,
      controller.address,
      reverseRegistrar.address,
    ],
    log: true,
  }
  const publicResolver = await deploy('PublicResolver', deployArgs)
  if (!publicResolver.newlyDeployed) return

  const tx = await reverseRegistrar.setDefaultResolver(publicResolver.address)
  console.log(
    `Setting default resolver on ReverseRegistrar to PublicResolver (tx: ${tx.hash})...`,
  )
  await tx.wait()

  if ((await registry.owner(ethers.utils.namehash('resolver.eth'))) === owner) {
    const publicResolversss = await ethers.getContract('PublicResolver')
    const pr = (await ethers.getContract('PublicResolver')).connect(
      await ethers.getSigner(owner),
    )
    const resolverHash = ethers.utils.namehash('resolver.eth')
    const tx2 = await registry.setResolver(resolverHash, pr.address)
    console.log(
      `Setting resolver for resolver.eth to PublicResolver (tx: ${tx2.hash})...`,
    )
    await tx2.wait()

    const tx3 = await pr['setAddr(bytes32,address)'](resolverHash, pr.address)
    console.log(
      `Setting address for resolver.eth to PublicResolver (tx: ${tx3.hash})...`,
    )
    await tx3.wait()

    const PublicResolverAddress = await pr['addr(bytes32)'](resolverHash)
    console.log(
      `resolver.eth=====>>>>>>> PublicResolverAddress :(${PublicResolverAddress})...`,
    )

    // ------------------------域名注册----------------------
    const domainName = 'mydomain' // 注册域名
    const ownerAddress = deployer // 域名的所有者地址
    const duration = 31536000 // 注册时长（1年，秒为单位）
    const secret = ethers.utils.hexlify(ethers.utils.randomBytes(32)) // 防止抢注的秘密值
    const resolverAddress = PublicResolverAddress // 公共解析器的合约地址

    await registerDomain(
      domainName,
      ownerAddress,
      duration,
      secret,
      resolverAddress,
      publicResolversss,
    )
    const ret = await pr['addr(bytes32)'](
      ethers.utils.namehash(`${domainName}.eth`),
    )
    console.log(`${domainName} resolver address :(${ret})`)

    // -----------------验证注册结果-------------------------
    //根据反向解释器节点，获取地址的域名 addr.reverse
    const reverseRegistrar = await ethers.getContract('ReverseRegistrar')
    const reverseNode = await reverseRegistrar.node(ownerAddress)
    // 获取反向解析器合约地址
    const reverseNode_resolverAddress = await registry.resolver(reverseNode)
    console.log('reverseNode_resolverAddress : ', reverseNode_resolverAddress)
    const reverseNode_resolver = await (
      await ethers.getContractFactory('PublicResolver')
    ).attach(reverseNode_resolverAddress)
    const ensName = await reverseNode_resolver.name(reverseNode)
    console.log(`${ownerAddress} domain name : ${ensName}`)
  } else {
    console.log(
      'resolver.eth is not owned by the owner address, not setting resolver',
    )
  }
}

async function registerDomain(
  domainName: any,
  ownerAddress: any,
  duration: any,
  secret: any,
  resolverAddress: any,
  publicResolver: any,
) {
  // 获取 ETHRegistrarController 合约实例
  const ethRegistrarController = await ethers.getContract(
    'ETHRegistrarController',
  )

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

func.id = 'resolver'
func.tags = ['resolvers', 'PublicResolver']
func.dependencies = [
  'registry',
  'ETHRegistrarController',
  'NameWrapper',
  'ReverseRegistrar',
]

export default func
