/*
 * @Author: JUEDIZHE
 * @Date: 2021-12-05 16:11:04
 * @LastEditors: OBKoro1
 * @LastEditTime: 2021-12-06 19:38:10
 * @Description:
 */

// 1. 找到一个入口文件
// 2. 解析这个入口文件，提取他的依赖
// 3. 解析入口文件依赖的依赖，即递归的去创建一个文件间的依赖关系图，描述所有文件的依赖关系
// 4. 把所有文件打包成一个文件

const fs = require('fs');
const babylon = require('babylon');
const traverse = require('babel-traverse').default;
const path = require('path');
const babel = require('babel-core');


// 为了保持自增需要把计算自增的ID放在createAsset外面
let ID = 0;

function createAsset(filename) {
    // 同步读取文件内容
    const content = fs.readFileSync(filename, 'utf-8');
    // 获取语法树
    const ast = babylon.parse(content, {
        sourceType: "module"
    });

    // 定义变量存储entry.js相关依赖
    const dependencies = [];
    // 遍历到语法树目标节点
    traverse(ast, { // 第二个参数是对每一个节点要做的什么事情，咱们选择ImportDeclaration节点
        ImportDeclaration: ({
            node // node就是语法树输出的，节点
        }) => {
            dependencies.push(node.source.value);
        }
    });

    const {code} = babel.transformFromAst(ast, null, {
        presets: ['env']
    })

    // 使传入的文件能够与获得的依赖一一对应，再抛出去
    const id = ID++;
    return {
        id,
        filename,
        dependencies,
        code
    }
}

function createGraph(entry) {
    // 传参调用(传入我们的入口文件路径作为参数)
    const mainAsset = createAsset(entry); // 参数为相对路径
    // 我们需要一个数组allAsset去存储所有文件的依赖信息例如mainAsset的这类信息
    // 因为我们会有多个文件，所以需要数组去存储
    // 现在我们就一个文件mainAsset
    const allAsset = [mainAsset];
     // 现在我们遍历allAssets，我们在遍历的过程中会一直往allAssets中推东西，一直遍历到结束，所以用了一个数组
    for (let asset of allAsset) {
        // 拿到当前这个文件asset.filename所在的目录名
        // 拿到目录名才能拼出他的结对路径
        const dirname = path.dirname(asset.filename);

        // 当我们把相对路径转化为绝对路径后，我们需要一个map，记录dependencies中的相对路径 和 childAsset的对应关系。
        // 因为我们后面要做依赖的引入，需要这样的一个对应关系。
        asset.mapping = {}

        // 遍历当前文件的依赖
        asset.dependencies.forEach(relativePath => {
            // 获取当前文件（entry.js）依赖（message.js）的绝对路径
            const absolutePath = path.join(dirname, relativePath);
            // 之前的这些我们都是拿的当前文件（例如entry.js）的依赖，获取到的是当前文件的依赖的绝对路径
            // 那当前文件的依赖的相关信息（即entry.js的依赖的依赖信息）
            // 即A依赖B，通过上面的一系列方法可以获取到B是谁，B的绝对路径是什么了，那B的依赖文件C我们怎么获取，怎么知道C的绝对路径是什么呢？
            // 很简单，我们像之前entry.js一样，直接把B的绝对路径当做参数，传给createGraph
            // 即类似遍历递归！！！！！！
            const childAsset = createAsset(absolutePath); // 获取到依赖文件的相关依赖信息了

            // 用相对路径作为key
            asset.mapping[relativePath] = childAsset.id;
            // 把当前文件的依赖相对路径转化后的信息推到数组allAsset，这样allAsset就有新的信息继续遍历了
            allAsset.push(childAsset); // 这样做相当于是递归了，一遍遍的遍历
        })
    }
    return allAsset;
}

function bundle(graph) {
    // 首先我们确定我们最后输出的是一个字符串的形式
    // 所以最后的代码块一定是一个字符串，我们首先用一个空字符串声明这个变量
    let modules = '';

    // 然后咱们遍历graph，去获取所有的module，然后都拼接在一起，成为一个字符串
    // graph里面其实每一个item即module
    // 然后循环graph把module拼接，拼接怎么拼？
    // 就是需要一个id与各种参数对应的，加逗号是因为一直要往modules上拼接东西，所以要加逗号分割每次拼接的东西
    // modules其实就是一个对象

    graph.forEach(module => {
        modules += `${module.id}:[  // modules其实就是一个对象
            function(require, module, exports) {
                // 代码体就是我们刚才生成的code
                ${module.code}
                // 其实我们要遍历的就是code这个东西，我们因为需要require, module, exports，所以我们以一个函数的形式把code包裹
                // 然后在需要的时候可以调用这个函数
                
                // 其实此时除了require，module跟exports都可以取到了
                // module就是我们传进来的graph的item即module
                // exports就是module的属性，可以暂时理解为就是一个空对象
            },
            ${JSON.stringify(module.mapping)},
        ],`
    });
    // 实现 require方法
    const reslut = `
        (function(modules){
            function require(id) {
                // 我们可以通过传入的id，再根据自执行函数接受到的modules，可以获取一些东西
                // 取到什么东西呢？请看上面的graph遍历，使用modules[id]，我们可以获取到一个数组
                // 这个数组元素1是一个function，元素2是一个mapping
                
                const [fn, mapping] = modules[id]; //通过id，就是获取对应的一个数组，获取到里面的元素function、mapping
                
                // 此时此步骤获取的function也就是定义的fn是谁？还记得上面modules拼接代码体内定义的function了吗，就是它
                // 它有三个参数，分别是require，module，exports
                
                // 现在咱们定义一个localRequire函数，也就是当前要传给后面代码体的一个require函数，咱们定义为localRequire
                
                function localRequire(relativePath) {
                    // 这个require是为了传给后面去引入各种自己的依赖的
                    // localRequire接受的参数为一个相对路径
                    
                    // 然后可以直接调用定义的require函数，是把现有的各种资源都能拿到
                    // require接受的是一个id，这个id我们怎么获取呢？还记得mapping吗？asset.mapping[relativePath] = childAsset.id
                    // 而此时我们通过modules已经获取到了mapping，故通过相对路径mapping[relativePath]获取通过createGraph方法存到mapping属性中的id
                    return require(mapping[relativePath]);
                }
                // 此时声明的localRequire函数可以继续调用require（即获取到mapping里的id，就可以继续调用require了）
                
                //接下来声明module，module是有一个exports属性的，所以可以直接定义为下面的代码体
                const module = { exports: {}};
                
                // 然后执行fn
                // fn还记得是什么样子吗？还记得上面modules拼接代码体内定义的function吗？它接受三个参数require, module, exports
                // 其中require就是localRequire（什么是依赖，所谓的依赖就是咱们前面定义的用id跟文件存储依赖文件的属性作一一对应的，所以必然是一个id）
                // 第二个参数module，上面声明过的
                // 第三个参数是exports，其实就是module.exports
                // 其实执行该fn也就是执行咱们在createAsset方法中通过babel工具获取的code
                
                fn(localRequire, module, module.exports);
                
                // 在commonjs规范要求中，加载（导入）某个模块，其实就是加载（导入）该模块的module.exports属性
                // 故require返回的就是module.exports
                
                return module.exports;
            }
            require(0); // 先require(0)，因为咱们初始的，最开始的id是0，通过require(0)，实现对入口文件的调用
        })({${modules}})
    `;
    return reslut;
}

const graph = createGraph('./source/entry.js');
const result = bundle(graph);
console.log(result);
