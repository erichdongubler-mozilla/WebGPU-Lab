import {GPU} from "../webgpu/gpu";
import {Texture} from "../webgpu/texture";
import {Buffer} from "../webgpu/buffer";
import {GPUAbstractRunner, RunnerType} from "../AbstractGPURunner";
import {Render} from "../render/render";

export class Raytrace extends GPUAbstractRunner {
    width: number;
    height: number;

    texture: Texture;
    render: Render;

    bind_group_layout: GPUBindGroupLayout;
    bind_group: GPUBindGroup;
    pipeline_layout: GPUPipelineLayout;
    compute_pipeline: GPUComputePipeline;
    shader: GPUProgrammableStage;
    stagingBuffer: Buffer
    stagingData: Float32Array

    filename: string;

    showOnScreen: boolean;

    constructor(filename: string, showOnScreen: boolean) {
        super();
        this.showOnScreen = showOnScreen
        this.filename = filename
        this.width = GPU.viewport.width
        this.height = GPU.viewport.height
    }

    override getType(): RunnerType {
        return RunnerType.ANIM
    }

    override async Destroy() {
        if (this.showOnScreen) {
            await this.render.Destroy();
        }
        this.texture.destroy()
    }

    override async Init() {
        console.log("Create Texture");
        this.texture = GPU.CreateStorageTexture(this.width, this.height, "rgba32float");

        if (this.showOnScreen) {
            this.render = new Render(this.texture);
            await this.render.Init();
        }

        this.stagingBuffer = GPU.CreateUniformBuffer(4*3 + 4); // must be a multiple of 16 bytes
        this.stagingData = new Float32Array(4);

        this.shader = await GPU.CreateShader("scripts/raytrace/" + this.filename);

        this.bind_group_layout = GPU.device.createBindGroupLayout({
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                storageTexture: {
                    access: "write-only",
                    format: "rgba32float"
                }
            }, {
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: "uniform"
                }
            }]
        });

        this.bind_group = GPU.device.createBindGroup({
            layout: this.bind_group_layout,
            entries: [{
                binding: 0,
                resource: this.texture.textureView
            }, {
                binding: 1,
                resource: this.stagingBuffer.resource
            }]
        })

        this.pipeline_layout = GPU.device.createPipelineLayout({
            bindGroupLayouts: [this.bind_group_layout]
        });

        this.compute_pipeline = GPU.device.createComputePipeline({
            layout: this.pipeline_layout,
            compute: this.shader
        });
    }

    override getCommandBuffer(): GPUCommandBuffer {
        this.stagingData[0] = GPU.mouseCoordinate.x; // set iMouseX
        this.stagingData[1] = GPU.mouseCoordinate.y; // set iMouseY
        this.stagingData[2] += 0.01; // increase iTime
        this.stagingData[3] = 0.; // nothing

        GPU.device.queue.writeBuffer(this.stagingBuffer.buffer, 0, this.stagingData)
        let encoder: GPUCommandEncoder = GPU.device.createCommandEncoder({});
        //let uploadbuffer: GPUBuffer = this.stagingBuffer.updateBufferData(0, this.stagingData, encoder) // TODO: must be destoryed
        {
            let pass: GPUComputePassEncoder = encoder.beginComputePass();
            pass.setBindGroup(0, this.bind_group);
            pass.setPipeline(this.compute_pipeline);
            pass.dispatchWorkgroups(this.width/8, this.height/8);
            pass.end();
        }
        return encoder.finish();
    }

    override async Run() {
        if (this.showOnScreen) {
            GPU.device.queue.submit([this.getCommandBuffer(), this.render.getCommandBuffer()]);
        } else {
            GPU.device.queue.submit([this.getCommandBuffer()]);
        }
        await GPU.device.queue.onSubmittedWorkDone();
    }
}
