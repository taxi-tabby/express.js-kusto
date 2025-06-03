// Example injectable module
export class ExampleService {
    private data: string = 'Hello from ExampleService';

    getData(): string {
        return this.data;
    }

    setData(newData: string): void {
        this.data = newData;
    }

    processData(input: string): string {
        return `${this.data}: ${input}`;
    }
}

// Export as default for automatic injection
export default ExampleService;