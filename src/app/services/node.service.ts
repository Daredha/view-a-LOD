import { Injectable } from '@angular/core';
import { Direction, NodeModel, NodeObj } from '../models/node.model';
import { SparqlService } from './sparql.service';

@Injectable({
  providedIn: 'root',
})
export class NodeService {
  constructor(private sparql: SparqlService) {}

  getObjs(node: NodeModel | undefined, preds: string[]): NodeObj[] {
    if (!node) {
      return [];
    }

    const objs = [];
    for (const pred of preds) {
      if (!(pred in node)) {
        continue;
      }
      for (const obj of node[pred]) {
        const noObjFoundForThisPred =
          !obj || !obj.value || obj?.value.length === 0;
        if (noObjFoundForThisPred) {
          continue;
        }

        const objValue = obj.value;
        objs.push({
          value: objValue,
          direction: obj.direction,
        });
      }
    }

    return objs;
  }

  getObjValues(
    node: NodeModel | undefined,
    preds: string[],
    direction: Direction | undefined = undefined,
    returnUniqueValues = false,
  ) {
    let objs = this.getObjs(node, preds);
    if (direction !== undefined) {
      objs = objs.filter((obj) => obj.direction === direction);
    }
    const objValues = objs.map((o) => o.value);
    return returnUniqueValues ? Array.from(new Set(objValues)) : objValues;
  }

  getObjValuesByDirection(
    node: NodeModel | undefined,
    preds: string[],
    direction: Direction,
  ) {
    return this.getObjs(node, preds)
      .filter((o) => o.direction === direction)
      .map((o) => o.value);
  }

  getId(node: NodeModel): string {
    return this.getObjValues(node, ['@id'])[0];
  }

  getEndpointId(node: NodeModel) {
    return this.getObjValues(node, ['endpointId'])[0];
  }

  getPredicates(node: NodeModel): string[] {
    return Object.keys(node);
  }

  async enrichWithIncomingRelations(nodes: NodeModel[]): Promise<NodeModel[]> {
    console.log('Enriching with incoming relations...', nodes);
    const promises: Promise<void>[] = [];

    for (const node of nodes) {
      const promise: Promise<void> = this.sparql
        .getIncomingRelations(node)
        .then((sparqlIncomingRelations) => {
          console.log('Received incoming relations for node:', node['@id'], 'Relations:', sparqlIncomingRelations);
          
          // Handle empty or null results
          if (!sparqlIncomingRelations) {
            console.log('No incoming relations found for node:', node['@id']);
            return;
          }
          
          if (!Array.isArray(sparqlIncomingRelations)) {
            console.error('Expected array of relations but got:', sparqlIncomingRelations);
            return;
          }

          for (const sparqlIncomingRelation of sparqlIncomingRelations) {
            console.log('Processing relation:', sparqlIncomingRelation);
            const pred = sparqlIncomingRelation.pred;
            if (!(pred in node)) {
              node[pred] = [];
            }

            const existingValues: string[] = this.getObjValues(node, [pred]);
            const relationIsAlreadySaved = existingValues.includes(
              sparqlIncomingRelation.sub,
            );
            if (relationIsAlreadySaved) {
              continue;
            }

            const incomingRelation: NodeObj = {
              value: sparqlIncomingRelation.sub,
              direction: Direction.Incoming,
            };

            node[pred].push(incomingRelation);
          }
        })
        .catch((error) => {
          console.error('Error enriching node with incoming relations:', error);
          // Don't throw here, just log the error and continue with other nodes
        });
      promises.push(promise);
    }

    await Promise.all(promises);

    return nodes;
  }
}
