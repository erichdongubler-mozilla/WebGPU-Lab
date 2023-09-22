import {Texture, TextureType} from "./texture";
import {LoadTextResource} from "./utils";
import {Buffer} from "./buffer";
import {BufferFactory} from "./bufferFactory";
import {TextureFactory} from "./textureFactory";

type Rect = { width: number, height: number };
type Coordinate = { x: number, y: number, wheel: number };

export class GPU {
    private static adapter: GPUAdapter;
    private static adapterInfo: GPUAdapterInfo;
    static device: GPUDevice;
    private static gpuContext: GPUCanvasContext;
    public static viewport: Rect = {width: 0, height: 0};
    public static mouseCoordinate: Coordinate = {x: 0, y: 0, wheel: 0};
    public static isInitialized: boolean

    static async Init(powerPreference: GPUPowerPreference) {
        this.isInitialized = false;
        console.log("Initialize WebGPU");
        console.log("Request Adapter");
        if (navigator.gpu == null) {
            throw new Error("WebGPU not supported");
        }
        await this.RequestAdapterAndDevice(powerPreference);
    }

    static async RequestAdapterAndDevice(powerPreference: GPUPowerPreference) {
        this.adapter = await navigator.gpu.requestAdapter({
            //powerPreference: "high-performance"
            //powerPreference: "low-power"
            powerPreference: powerPreference
        });
        if (this.adapter == null) {
            throw new Error("Cannot request GPU adapter");
        }
        this.adapterInfo = await this.adapter.requestAdapterInfo()
        console.log("Request Device");
        this.device = await this.adapter.requestDevice();
        if (this.device == null) {
            throw new Error("Cannot get GPU device");
        }
    }

    static SetCanvas(id: string) {
        console.log("Set Canvas")
        const canvas: HTMLCanvasElement = <HTMLCanvasElement>document.getElementById(id);
        this.gpuContext = canvas.getContext("webgpu");
        if (this.gpuContext == null) {
            throw new Error("WebGPU context null");
        }
        canvas.onmousemove = (e) => {
            this.mouseCoordinate.x = e.offsetX / canvas.clientWidth * canvas.width
            this.mouseCoordinate.y = canvas.height - e.offsetY / canvas.clientHeight * canvas.height
        }
        canvas.onwheel = (e) => {
            this.mouseCoordinate.wheel += e.deltaY*0.001
            e.preventDefault()
        }

        this.viewport.width = canvas.width
        this.viewport.height = canvas.height
        console.log("canvas width: " + this.viewport.width)
        console.log("canvas height: " + this.viewport.height)
        console.log("canvas clientWidth: " + canvas.clientWidth)
        console.log("canvas clientHeight: " + canvas.clientHeight)
        const devicePixelRatio = window.devicePixelRatio || 1
        console.log("devicePixelRatio: " + devicePixelRatio)
        this.gpuContext.configure({
            device: this.device,
            format: navigator.gpu.getPreferredCanvasFormat(),
            alphaMode: "opaque",
        });
        console.log("Set Canvas Done")
        this.isInitialized = true
    }

    static GetAdapterInfo(): GPUAdapterInfo {
        return this.adapterInfo
    }

    static GetAdapterFeatures(): ReadonlySet<string> {
        return this.adapter.features
    }

    static GetWGSLFeatures(): ReadonlySet<string> {
        return navigator.gpu.wgslLanguageFeatures
    }


    static GetDeviceFeatures(): ReadonlySet<string> {
        return this.device.features
    }

    static GetDeviceLimits(): GPUSupportedLimits {
        return this.device.limits
    }

    static getRenderPassDescriptor(): GPURenderPassDescriptor {
        return {
            colorAttachments: [{
                view: GPU.gpuContext.getCurrentTexture().createView(),
                clearValue: {r: 0.0, g: 0.0, b: 0.0, a: 1.0},
                loadOp: "clear",
                storeOp: "store"
            }],
        };
    }

    static getPreferredFormat(): GPUTextureFormat {
        return navigator.gpu.getPreferredCanvasFormat()
    }

    static getMouseCoordinate(): Coordinate {
        return this.mouseCoordinate;
    }

    static CreateTexture(width: number, height: number, format: GPUTextureFormat): Texture {
        return new Texture(width, height, 1, format);
    }

    static CreateTextureArray(width: number, height: number, depth: number, format: GPUTextureFormat): Texture {
        return new Texture(width, height, depth, format);
    }

    static CreateStorageTexture(width: number, height: number, format: GPUTextureFormat): Texture {
        return new Texture(width, height, 1, format, TextureType.Storage);
    }

    static CreateStorageTextureArray(width: number, height: number, depth: number, format: GPUTextureFormat): Texture {
        return new Texture(width, height, depth, format, TextureType.Storage);
    }

    static async CreateTextureFromArrayBuffer(width: number, height: number, format: GPUTextureFormat, data: ArrayBuffer): Promise<Texture> {
        return TextureFactory.CreateTextureFromArrayBuffer(width, height, format, data)
    }

    static async createTextureFromImage(src: string): Promise<Texture> {
        return TextureFactory.createTextureFromImage(src)
    }

    static async createTextureFromTexture(src: Texture, format: GPUTextureFormat): Promise<Texture> {
        return TextureFactory.createTextureFromTexture(src, format)
    }


    static CreateSampler(): GPUSampler {
        return this.device.createSampler({
            magFilter: "linear",
            addressModeU: "repeat",
            addressModeV: "repeat",
            addressModeW: "repeat"
        });
    }

    static CreateClampedSampler(): GPUSampler {
        return this.device.createSampler({
            magFilter: "linear",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
            addressModeW: "clamp-to-edge"
        });
    }

    static CreateStorageBufferFromArrayBuffer(data: ArrayBuffer): Buffer {
        return BufferFactory.createFromArrayBuffer(data)
    }

    static CreateUniformBuffer(size: number): Buffer {
        return BufferFactory.createUniformBuffer(size);
    }

    static CreateBufferCopy(size: number): Buffer {
        return BufferFactory.createCopyBuffer(size);
    }

    static workDone(): Promise<undefined> {
        return this.device.queue.onSubmittedWorkDone();
    }

    static async CreateShaderFromURL(...urls: string[]): Promise<GPUProgrammableStage> {
        console.log("Load Shader from '" + urls + "'")
        let code: string = ""
        for (let i = 0; i < urls.length; i++) {
            code += await LoadTextResource(urls[i])
        }
        return await this.CompileShader(code, urls.join(","))
    }

    static async CompileShader(code: string, label: string=null): Promise<GPUProgrammableStage> {
        let module: GPUShaderModule = this.device.createShaderModule({
            label: label,
            code: code
        });

        // check for errors during compilation
        let info = await module.getCompilationInfo()
        const containsErrors: boolean = info.messages.filter((message) => {
            return message.type === "error"
        }).length > 0

        if (containsErrors) {
            throw new Error("Shader '" + label + "' compiled with errors")
        }
        return {
            entryPoint: "main",
            module: module
        }
    }

    static async CopyBufferToBuffer(src: Buffer, dest: Buffer, size: number) {
        let encoder: GPUCommandEncoder = GPU.device.createCommandEncoder({
            label: "command_encoder"
        });
        encoder.copyBufferToBuffer(src.buffer, 0, dest.buffer, 0, size)
        GPU.device.queue.submit([encoder.finish()]);
        await GPU.device.queue.onSubmittedWorkDone();
    }

    static async Render(texture: Texture) {
        let result = await Promise.all([
            GPU.CreateShaderFromURL("scripts/webgpu/shader/render.vert.wgsl"),
            GPU.CreateShaderFromURL("scripts/webgpu/shader/render.frag.wgsl")])
        let vertShader = result[0];
        let fragShader = result[1];

        if (texture.isFloat == false) {
            fragShader = await this.CreateShaderFromURL("scripts/webgpu/shader/render_int.frag.wgsl")
        }
        let sampler = this.CreateSampler();

        let layout: GPUBindGroupLayout = GPU.device.createBindGroupLayout({
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {sampleType: "unfilterable-float"}
            }, {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: {}
            }]
        });

        if (texture.isFloat == false) {
            layout = GPU.device.createBindGroupLayout({
                entries: [{
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {sampleType: "sint"}
                }, {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {}
                }]
            });
        }

        let bind_group: GPUBindGroup = GPU.device.createBindGroup({
            layout: layout,
            entries: [{
                binding: 0,
                resource: texture.textureView
            }, {
                binding: 1,
                resource: sampler
            }]
        })

        let pipelineLayout: GPUPipelineLayout = GPU.device.createPipelineLayout({
            bindGroupLayouts: [layout]
        });

        const pipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: vertShader,
            fragment: {
                entryPoint: fragShader.entryPoint,
                module: fragShader.module,
                constants: fragShader.constants,
                targets: [{
                    format: navigator.gpu.getPreferredCanvasFormat()
                }]
            },
            primitive: {
                topology: "triangle-strip",
                stripIndexFormat: "uint32"
            }
        });

        let render = () => {
            console.log("render");
            const commandEncoder = this.device.createCommandEncoder({});
            const passEncoder = commandEncoder.beginRenderPass(this.getRenderPassDescriptor());
            passEncoder.setPipeline(pipeline);
            passEncoder.setBindGroup(0, bind_group);
            passEncoder.draw(4, 1, 0, 0);
            passEncoder.end();

            this.device.queue.submit([commandEncoder.finish()]);
        }
        requestAnimationFrame(render);
    }
}


